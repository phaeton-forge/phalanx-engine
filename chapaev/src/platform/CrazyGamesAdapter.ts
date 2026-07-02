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
  ROOM_CODE_PATTERN,
} from './platformUtils.ts';
import { audioSettings } from '../config/AudioSettings.ts';

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const GUEST_ID_KEY = 'chapaev_guest_id';

const CRAZYGAMES_SDK_SCRIPT_ID = 'crazygames-sdk';
const CRAZYGAMES_SDK_SRC = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';

// CrazyGames flattens the invite-params object into individual query params on
// the invite URL and exposes them back via `inviteParams[key]` / getInviteParam.
// We key our private-room code on `roomId` — the same field showInviteButton /
// updateRoom already round-trip natively — so the portal serialises it as a
// plain string. (An earlier attempt nested it under an `inviteParams` object,
// which the SDK stringified to the literal `[object Object]`.)
const INVITE_ROOM_KEY = 'roomId';

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

/**
 * Basic-launch monetization switch. CrazyGames' "Basic Implementation" tier
 * requires monetization to be DISABLED (no SDK ads), so we gate every ad
 * request behind this flag rather than deleting the code. Flip to `true` when
 * we graduate to the Full tier (ads via SDK, AdBlock handling, guideline
 * compliance) — the `requestAd` plumbing below is already wired.
 */
const MONETIZATION_ENABLED = false;

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

/**
 * Free-form invite payload the portal round-trips between the inviter and the
 * invitee. We only ever put our room code in it, under the `roomCode` key.
 */
type CrazyInviteParams = Record<string, string | number | boolean>;

/** Fires while the game is running when the player accepts a party invite. */
type JoinRoomListener = (inviteParams: CrazyInviteParams | null) => void;

/** Subset of the CrazyGames User module user object we consume. */
interface CrazyUser {
  username?: string;
  profilePictureUrl?: string;
}

/** Fires when the player logs in on CrazyGames while the game is running. */
type AuthListener = (user: CrazyUser | null) => void;

/** CrazyGames User module (v3), accessed via `SDK.user`. */
interface CrazyUserModule {
  /**
   * Synchronous property (NOT a method): false off-portal / on embedding
   * domains. Guard every other user call behind it.
   */
  readonly isUserAccountAvailable?: boolean;
  /** Async: resolves the logged-in user, or null when not signed in. */
  getUser?: () => Promise<CrazyUser | null>;
  /** Sync: register a login listener (login on CG auto-logs into the game). */
  addAuthListener?: (listener: AuthListener) => void;
  removeAuthListener?: (listener: AuthListener) => void;
}

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

    // ── Multiplayer / room module (v3) ───────────────────────────────
    /**
     * Invite payload the game was cold-launched with, or null when the launch
     * was not from an invite. We stash our room code under `roomId`.
     */
    readonly inviteParams?: CrazyInviteParams | null;
    /**
     * Announce the current room + joinable state to the portal. We send `roomId`
     * (which the portal serialises into invite links as `inviteParams.roomId`)
     * plus `isJoinable`.
     */
    updateRoom?: (options: { roomId?: string; isJoinable?: boolean }) => void;
    /** Announce the player left their current room. */
    leftRoom?: () => void;
    /** Show the portal's native invite button for a room. */
    showInviteButton?: (options: { roomId?: string }) => string | void;
    /** Hide the portal's native invite button. */
    hideInviteButton?: () => void;
    /** Register a listener fired when the player accepts a live party invite. */
    addJoinRoomListener?: (listener: JoinRoomListener) => void;
    removeJoinRoomListener?: (listener: JoinRoomListener) => void;
  };
  /** User / account module (v3). Absent off-portal. */
  user?: CrazyUserModule;
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
 * - Ads are gated behind `MONETIZATION_ENABLED` (false for the Basic launch
 *   tier, which mandates monetization off). When enabled they'd be shown via
 *   `SDK.ad.requestAd('midgame', …)`; frequency capping is owned by CrazyGames
 *   — we intentionally do NOT use FullscreenAdGate here (calling requestAd too
 *   often just triggers an adError, which we swallow).
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

  /**
   * Portal display name resolved during `init()` (CrazyGames User module) and
   * kept fresh via the auth listener. Null when the player isn't logged in or
   * account functionality is unavailable (off-portal).
   */
  private username: string | null = null;

  /**
   * Registered auth listener. This adapter lives for the whole page lifecycle
   * and has no dispose path (same as `settingsListener` / `visibilityHandler`),
   * so we never unregister it — the field is retained only for reference and
   * potential future cleanup if a teardown path is ever added.
   */
  private authListener: AuthListener | null = null;

  /**
   * Wrapped join listeners currently attached to the SDK. A Set (not a Map
   * keyed by the consumer callback) so the same `cb` can be registered more
   * than once without one registration clobbering another's wrapper — each
   * `onJoinRoomRequest` call owns exactly the wrapper it created.
   */
  private joinRoomListeners = new Set<JoinRoomListener>();

  /**
   * Portal-native invite URL for the current room, captured from
   * `showInviteButton`'s return value (the same link `inviteLink` produces).
   * Unlike a plain `?ROOM=` URL, this carries the CrazyGames `inviteParams`, so
   * a friend opening it is routed through the portal's cold-start `inviteParams`
   * / live `addJoinRoomListener` channels rather than bypassing them. Null off
   * portal, before a room is announced, or after the room is left.
   */
  private portalInviteUrl: string | null = null;

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

    // Resolve the portal display name (User module) + keep it fresh on login.
    // Off-portal `isUserAccountAvailable` is false, so this is a clean no-op.
    await this.syncPortalUser();
    this.subscribeToAuthChanges();

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

  /**
   * Portal display name resolved from the CrazyGames User module during
   * `init()` (and refreshed on login). Null when the player isn't logged in or
   * account functionality is unavailable — callers then fall back to the
   * server-assigned guest name.
   */
  getUsername(): string | null {
    return this.username;
  }

  getLanguage(): Language | null {
    return mapLanguageCode(navigator.language);
  }

  getLaunchRoomCode(): string | null {
    return consumeUrlRoomCode();
  }

  getInviteShareUrl(roomCode: string): string {
    // Prefer the portal-native invite link captured from `showInviteButton`:
    // it round-trips `inviteParams.roomCode` through CrazyGames, so a friend
    // opening it hits the portal's cold-start `inviteParams` / live join-room
    // channels. A plain ?ROOM= link bypasses the portal entirely — the invitee
    // lands on a raw embed with no inviteParams and no join-room event, which is
    // exactly the "opens on the menu" failure. Fall back to ?ROOM= only when the
    // portal gave us nothing (older SDK, or button not yet shown).
    return this.portalInviteUrl ?? defaultInviteShareUrl(roomCode);
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

  // ── Multiplayer room API ───────────────────────────────────────────
  // Thin wrappers over `SDK.game.*` (the CrazyGames Multiplayer module). All
  // are guarded so they cleanly no-op off-portal (`disabled`) or when running
  // against an older SDK that lacks the method. The room code is our own
  // private-room code, carried to the portal as `inviteParams.roomId`.

  /**
   * Room code the game was cold-launched with, when opened from an invite.
   * Reads `SDK.game.inviteParams.roomId` and validates it against the shared
   * room-code pattern so a malformed payload can't drive a bogus join. Null
   * off-portal or for a normal (non-invite) launch.
   */
  getInviteRoomCode(): string | null {
    if (this.environment === 'disabled') return null;
    try {
      return this.extractRoomCode(this.sdk?.game.inviteParams ?? null);
    } catch (e) {
      console.warn('[CrazyGames] reading inviteParams failed', e);
      return null;
    }
  }

  updateRoom(roomCode: string, isJoinable: boolean): void {
    if (this.environment === 'disabled') return;
    const roomId = roomCode.trim().toUpperCase();
    try {
      // `roomId` is the invite-param the portal serialises into the share URL,
      // so a friend opening it gets `inviteParams.roomId` back.
      this.sdk?.game.updateRoom?.({ roomId, isJoinable });
    } catch (e) {
      console.warn('[CrazyGames] updateRoom failed', e);
    }
  }

  leftRoom(): void {
    if (this.environment === 'disabled') return;
    try {
      this.sdk?.game.leftRoom?.();
    } catch (e) {
      console.warn('[CrazyGames] leftRoom failed', e);
    }
  }

  showInviteButton(roomCode: string): void {
    if (this.environment === 'disabled') return;
    const roomId = roomCode.trim().toUpperCase();
    try {
      // `showInviteButton` returns the portal invite link (same as `inviteLink`)
      // — capture it so our own "copy link" button shares the portal URL, not a
      // raw ?ROOM= one. void return on older SDKs leaves the ?ROOM= fallback.
      const link = this.sdk?.game.showInviteButton?.({ roomId });
      this.portalInviteUrl = typeof link === 'string' && link ? link : null;
    } catch (e) {
      console.warn('[CrazyGames] showInviteButton failed', e);
      this.portalInviteUrl = null;
    }
  }

  hideInviteButton(): void {
    // Clear regardless of environment — the room association is gone.
    this.portalInviteUrl = null;
    if (this.environment === 'disabled') return;
    try {
      this.sdk?.game.hideInviteButton?.();
    } catch (e) {
      console.warn('[CrazyGames] hideInviteButton failed', e);
    }
  }

  /**
   * Subscribe to live party-invite joins. We wrap the consumer callback so the
   * portal's raw `inviteParams` is decoded to our room code and validated
   * before the game acts on it; an invite with a missing/invalid code is
   * ignored rather than driving a bogus join.
   */
  onJoinRoomRequest(cb: (roomCode: string) => void): () => void {
    // Require BOTH add and remove: registering a listener we can't later
    // detach would violate the "returns an unsubscribe fn" contract and leak.
    const game = this.sdk?.game;
    if (
      this.environment === 'disabled' ||
      !game?.addJoinRoomListener ||
      !game.removeJoinRoomListener
    ) {
      return () => {};
    }

    // Each call gets its own wrapper, tracked by identity in a Set — so the
    // same `cb` registered twice yields two independent, separately-removable
    // subscriptions rather than one clobbering the other.
    const wrapped: JoinRoomListener = (inviteParams) => {
      const roomCode = this.extractRoomCode(inviteParams);
      if (roomCode) cb(roomCode);
    };

    try {
      game.addJoinRoomListener(wrapped);
    } catch (e) {
      console.warn('[CrazyGames] addJoinRoomListener failed', e);
      return () => {};
    }
    this.joinRoomListeners.add(wrapped);

    let removed = false;
    return () => {
      if (removed || !this.joinRoomListeners.has(wrapped)) return;
      removed = true;
      this.joinRoomListeners.delete(wrapped);
      try {
        this.sdk?.game.removeJoinRoomListener?.(wrapped);
      } catch (e) {
        console.warn('[CrazyGames] removeJoinRoomListener failed', e);
      }
    };
  }

  /** Pull our validated room code out of a portal invite payload. */
  private extractRoomCode(params: CrazyInviteParams | null): string | null {
    const raw = params?.[INVITE_ROOM_KEY];
    // The portal serialises invite params to the URL and hands them back as
    // strings, but the SDK typings also allow numbers (doc examples use numeric
    // room ids) — coerce both, reject anything else, then pattern-validate.
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;
    const code = String(raw).trim().toUpperCase();
    return ROOM_CODE_PATTERN.test(code) ? code : null;
  }

  async tryShowFullscreenAd(
    _options: { blocking?: boolean } = {}
  ): Promise<boolean> {
    // Basic launch: monetization is disabled per CrazyGames' Basic tier, so we
    // never issue an ad request. Resolves `false` ("no ad shown") so callers
    // proceed straight into gameplay. Flip MONETIZATION_ENABLED for Full tier.
    if (!MONETIZATION_ENABLED) return false;
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

  /**
   * Resolve the portal display name once during init(). `getUser()` is async
   * and returns null when the player isn't signed in, so we cache whatever we
   * get and let callers fall back to the server-assigned guest name.
   */
  private async syncPortalUser(): Promise<void> {
    if (this.sdk?.user?.isUserAccountAvailable !== true) return;
    if (!this.sdk.user.getUser) return;
    try {
      const user = await this.sdk.user.getUser();
      this.username = this.normalizeUsername(user?.username);
    } catch (e) {
      console.warn('[CrazyGames] getUser failed', e);
    }
  }

  /**
   * Keep the cached display name fresh: logging in on CrazyGames mid-session
   * auto-logs into the game and fires this listener. Sync registration; the
   * listener itself just refreshes the cache for the next network connect.
   */
  private subscribeToAuthChanges(): void {
    // Same guard the User module contract requires for every user call: false
    // off-portal / on embedding domains, so this stays a clean no-op there.
    if (this.sdk?.user?.isUserAccountAvailable !== true) return;
    if (!this.sdk.user.addAuthListener) return;
    this.authListener = (user: CrazyUser | null) => {
      this.username = this.normalizeUsername(user?.username);
    };
    try {
      this.sdk.user.addAuthListener(this.authListener);
    } catch (e) {
      console.warn('[CrazyGames] addAuthListener failed', e);
      this.authListener = null;
    }
  }

  /** Trim and coerce empty/whitespace-only names to null. */
  private normalizeUsername(name: string | undefined): string | null {
    const trimmed = name?.trim();
    return trimmed ? trimmed : null;
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
