import type {
  PlatformAdapter,
  SafeAreaInsets,
  AuthScheme,
  Platform,
} from './PlatformAdapter.ts';
import type { Language } from '../i18n/i18n.ts';
import {
  mapLanguageCode,
  defaultInviteShareUrl,
  consumeUrlRoomCode,
} from './platformUtils.ts';
import { audioSettings } from '../config/AudioSettings.ts';

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const GUEST_ID_KEY = 'chapaev_guest_id';

const CRAZYGAMES_SDK_SCRIPT_ID = 'crazygames-sdk';
const CRAZYGAMES_SDK_SRC = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

/**
 * CrazyGames environment as reported by `SDK.environment` (synchronous getter
 * in v3).
 * - `local`      — running the CrazyGames dev/QA harness (or `?useLocalSdk=true`).
 * - `crazygames` — embedded in the real crazygames.com portal iframe. Ads work here.
 * - `disabled`   — served from any other origin (e.g. our own domain
 *   chapaev.phalanx-games.net). SDK calls that touch ads throw, so we no-op them.
 */
type CrazyEnvironment = 'local' | 'crazygames' | 'disabled';

type AdType = 'midgame' | 'rewarded';

interface CrazyAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: unknown, errorData?: unknown) => void;
}

/** Subset of `SDK.game.settings` we consume. */
interface CrazyGameSettings {
  muteAudio?: boolean;
  disableChat?: boolean;
}

type SettingsChangeListener = (newSettings: CrazyGameSettings) => void;

interface CrazyGamesSDK {
  /**
   * v3 requires explicit async initialisation before any module is usable.
   * The SDK is unusable until this resolves.
   */
  init: () => Promise<void>;

  /** Synchronous environment getter in v3 (was async `getEnvironment()` in v2). */
  readonly environment: CrazyEnvironment;

  ad: {
    /** v3 ad request. Callbacks only — promises are not supported for ads. */
    requestAd: (type: AdType, callbacks: CrazyAdCallbacks) => void;
  };
  game: {
    /** Signal SDK that our own loading finished (dismisses their splash). */
    sdkGameLoadingStop?: () => void;
    /** Mark the start of active, interactive gameplay. */
    gameplayStart?: () => void;
    /** Mark the end of active gameplay (menu, results, pause). */
    gameplayStop?: () => void;
    /** Host-controlled game settings (mute, chat). */
    readonly settings?: CrazyGameSettings;
    /** Register a listener fired whenever host game settings change. */
    addSettingsChangeListener?: (listener: SettingsChangeListener) => void;
    removeSettingsChangeListener?: (listener: SettingsChangeListener) => void;
    /**
     * True when the user should be dropped directly into a joinable multiplayer
     * room (e.g. launched from the Multiplayer landing page or a party).
     */
    readonly isInstantMultiplayer?: boolean;
  };
}

declare global {
  interface Window {
    CrazyGames?: {
      SDK?: CrazyGamesSDK;
    };
  }
}

let crazyGamesScriptPromise: Promise<void> | null = null;

function createGuestUserId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * CrazyGamesAdapter — wraps the CrazyGames HTML5 SDK **v3**.
 *
 * Design rules (mirrors the other adapters):
 * - The SDK script is injected only under this adapter, so it never loads on
 *   our own domain or inside Telegram.
 * - v3 requires `await SDK.init()` before any module call; `environment` is a
 *   synchronous getter afterwards.
 * - Ads are shown via `SDK.ad.requestAd('midgame', …)`. Frequency capping is
 *   owned by CrazyGames — we intentionally do NOT use FullscreenAdGate here
 *   (calling requestAd too often just triggers an adError, which we swallow).
 * - Audio muting has TWO sources, both routed through the transient
 *   `audioSettings.setMasterMuted()` master flag (never persisted, never
 *   clobbers the player's own volume sliders):
 *     1. host `settings.muteAudio` — takes priority over in-game audio settings
 *        (CrazyGames requirement), synced on init + via settings listener;
 *     2. an active midgame ad — muted on `adStarted`, restored on
 *        `adFinished`/`adError`.
 *   The effective mute is the OR of the two, so an ad ending never un-mutes a
 *   host that still wants silence, and vice-versa.
 * - No SDK call is ever made from ECS Simulation.step() / System.update().
 * - Ads only actually play when `environment === 'crazygames'`. On our own
 *   domain the environment is `disabled` and every ad call resolves to `false`
 *   without touching the SDK.
 */
export class CrazyGamesAdapter implements PlatformAdapter {
  readonly platform: Platform = 'crazygames';

  private sdk: CrazyGamesSDK | null = null;
  private environment: CrazyEnvironment = 'disabled';
  private userId: string | null = null;
  private resumeListeners: Array<() => void> = [];
  private visibilityHandler: (() => void) | null = null;
  private settingsListener: SettingsChangeListener | null = null;

  /** True while a midgame ad is on screen — prevents overlapping requests. */
  private adInFlight = false;

  /** Latched mute state from each source; effective mute is their OR. */
  private hostMuted = false;
  private adMuted = false;

  /** Tracks whether gameplayStart was emitted, to keep start/stop balanced. */
  private gameplayActive = false;

  async init(): Promise<void> {
    this.userId = this.loadOrCreateUserId();

    // Load + initialise the SDK best-effort. A failure here must not block the
    // game — we just fall back to an ad-free, unmuted experience.
    try {
      await this.injectSDKScript();
      const sdk = window.CrazyGames?.SDK ?? null;
      if (sdk) {
        // v3: must await init() before touching any module or `environment`.
        await sdk.init();
        this.sdk = sdk;
        this.environment = sdk.environment ?? 'disabled';
      }
      console.log('[CrazyGames] SDK v3 ready', {
        environment: this.environment,
      });
    } catch (e) {
      console.warn('[CrazyGames] SDK load/init failed — running ad-free', e);
      this.sdk = null;
      this.environment = 'disabled';
    }

    // Sync host mute preference and subscribe to changes. Off-portal the
    // settings object is absent, so this is a clean no-op.
    this.syncHostMute();
    this.subscribeToSettingsChanges();

    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        for (const cb of this.resumeListeners) cb();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  ready(): void {
    // First frame is rendered — tell CrazyGames our own loading finished so it
    // can dismiss its portal splash. Guarded: throws on `disabled`.
    if (this.environment === 'disabled') return;
    try {
      this.sdk?.game.sdkGameLoadingStop?.();
    } catch (e) {
      console.warn('[CrazyGames] sdkGameLoadingStop failed', e);
    }
  }

  getUserId(): string | null {
    return this.userId;
  }

  getAuthScheme(): AuthScheme {
    // CrazyGames auth (User module) is not integrated yet — treat as guest.
    return 'guest';
  }

  getAuthPayload(): string | null {
    return null;
  }

  getLanguage(): Language | null {
    return mapLanguageCode(navigator.language);
  }

  getLaunchRoomCode(): string | null {
    return consumeUrlRoomCode();
  }

  getInviteShareUrl(roomCode: string): string {
    // Inside the CrazyGames iframe `window.location` is our own embedded URL,
    // so a plain ?ROOM= link still resolves back to a playable instance.
    return defaultInviteShareUrl(roomCode);
  }

  /**
   * CrazyGames "instant multiplayer" flag. When true, the launcher (e.g. the
   * Multiplayer landing page or a party invite) expects us to drop the player
   * straight into a freshly-created, joinable room instead of the main menu.
   * False/absent off-portal.
   */
  isInstantMultiplayer(): boolean {
    if (this.environment === 'disabled') return false;
    try {
      return this.sdk?.game.isInstantMultiplayer === true;
    } catch {
      return false;
    }
  }

  async tryShowFullscreenAd(
    _options: { blocking?: boolean } = {}
  ): Promise<boolean> {
    // Ads only exist inside the real portal. On our own domain (`disabled`)
    // or local harness without ads, skip cleanly.
    if (!this.sdk || this.environment !== 'crazygames') return false;
    if (this.adInFlight) return false;

    this.adInFlight = true;
    console.log('[CrazyGames] requestAd midgame');

    // `blocking` is honoured: the promise resolves only once the ad is
    // finished or errors out, matching how callers expect matchmaking flows
    // to wait. CrazyGames has no "resolve on start" mode, so both blocking and
    // non-blocking callers get the same (post-ad) resolution.
    const shown = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean): void => {
        if (settled) return;
        settled = true;
        this.adInFlight = false;
        resolve(result);
      };

      try {
        this.sdk!.ad.requestAd('midgame', {
          adStarted: () => {
            console.log('[CrazyGames] ad started — muting game');
            this.setAdMuted(true);
          },
          adFinished: () => {
            console.log('[CrazyGames] ad finished');
            this.setAdMuted(false);
            finish(true);
          },
          adError: (error: unknown, errorData?: unknown) => {
            // Fired when no ad is available or the request is throttled.
            console.warn('[CrazyGames] ad error', error, errorData);
            this.setAdMuted(false);
            finish(false);
          },
        });
      } catch (e) {
        console.warn('[CrazyGames] requestAd threw', e);
        this.setAdMuted(false);
        finish(false);
      }
    });

    return shown;
  }

  // ── CrazyGames Gameplay events ─────────────────────────────────────
  // Called by Game around active match lifecycle so the portal knows when the
  // player is actually playing (required by CrazyGames QA). Safe no-op off-portal.

  onGameplayStart(): void {
    if (this.environment === 'disabled') return;
    if (this.gameplayActive) return;
    this.gameplayActive = true;
    try {
      this.sdk?.game.gameplayStart?.();
    } catch (e) {
      console.warn('[CrazyGames] gameplayStart failed', e);
    }
  }

  onGameplayStop(): void {
    if (this.environment === 'disabled') return;
    if (!this.gameplayActive) return;
    this.gameplayActive = false;
    try {
      this.sdk?.game.gameplayStop?.();
    } catch (e) {
      console.warn('[CrazyGames] gameplayStop failed', e);
    }
  }

  hapticImpact(_style: 'light' | 'medium' | 'heavy'): void {
    try {
      navigator.vibrate?.(30);
    } catch {
      // ignore
    }
  }

  onBackButton(_handler: () => void): () => void {
    // No platform back-button inside the CrazyGames iframe.
    return () => {};
  }

  getSafeAreaInsets(): SafeAreaInsets {
    return ZERO_INSETS;
  }

  onSafeAreaChange(_cb: (insets: SafeAreaInsets) => void): () => void {
    return () => {};
  }

  onResume(cb: () => void): () => void {
    this.resumeListeners.push(cb);
    return () => {
      this.resumeListeners = this.resumeListeners.filter((l) => l !== cb);
    };
  }

  setClosingConfirmation(_enabled: boolean): void {
    // Not applicable inside the portal iframe.
  }

  // ── Private: audio muting ──────────────────────────────────────────

  /**
   * Read the host's `settings.muteAudio` and latch it. CrazyGames requires
   * this to take priority over in-game audio settings. Off-portal the settings
   * object is undefined and we leave the host-mute latch false.
   */
  private syncHostMute(): void {
    let muted = false;
    try {
      muted = this.sdk?.game.settings?.muteAudio === true;
    } catch {
      muted = false;
    }
    this.hostMuted = muted;
    this.applyMasterMute();
  }

  private subscribeToSettingsChanges(): void {
    if (!this.sdk?.game.addSettingsChangeListener) return;
    this.settingsListener = (newSettings: CrazyGameSettings) => {
      this.hostMuted = newSettings?.muteAudio === true;
      this.applyMasterMute();
    };
    try {
      this.sdk.game.addSettingsChangeListener(this.settingsListener);
    } catch (e) {
      console.warn('[CrazyGames] addSettingsChangeListener failed', e);
      this.settingsListener = null;
    }
  }

  private setAdMuted(muted: boolean): void {
    this.adMuted = muted;
    this.applyMasterMute();
  }

  /**
   * Push the OR of every mute source into the shared transient master mute.
   * Reading `audioSettings.effective*Volume` elsewhere then reflects it without
   * ever touching the persisted user volumes.
   */
  private applyMasterMute(): void {
    audioSettings.setMasterMuted(this.hostMuted || this.adMuted);
  }

  // ── Private: identity & SDK bootstrap ──────────────────────────────

  private loadOrCreateUserId(): string {
    try {
      const stored = localStorage.getItem(GUEST_ID_KEY);
      if (stored) return stored;
      const id = createGuestUserId();
      localStorage.setItem(GUEST_ID_KEY, id);
      return id;
    } catch {
      return createGuestUserId();
    }
  }

  private injectSDKScript(): Promise<void> {
    if (window.CrazyGames?.SDK) {
      return Promise.resolve();
    }

    if (crazyGamesScriptPromise) {
      return crazyGamesScriptPromise;
    }

    crazyGamesScriptPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById(CRAZYGAMES_SDK_SCRIPT_ID);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => rejectScriptLoad(reject), {
          once: true,
        });
        return;
      }

      const script = document.createElement('script');
      script.id = CRAZYGAMES_SDK_SCRIPT_ID;
      script.async = true;
      script.src = CRAZYGAMES_SDK_SRC;
      script.onload = () => resolve();
      script.onerror = () => rejectScriptLoad(reject);
      document.head.appendChild(script);
    });

    return crazyGamesScriptPromise;
  }
}

function rejectScriptLoad(reject: (reason?: unknown) => void): void {
  crazyGamesScriptPromise = null;
  reject(new Error('Failed to load CrazyGames SDK script'));
}
