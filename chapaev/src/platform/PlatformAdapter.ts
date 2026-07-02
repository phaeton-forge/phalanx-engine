import type { Language } from '../i18n/i18n.ts';

export type Platform =
  | 'telegram'
  | 'yandex'
  | 'crazygames'
  | 'capacitor'
  | 'standalone';
export type AuthScheme = 'telegram' | 'yandex' | 'guest';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlatformAdapter {
  readonly platform: Platform;

  /**
   * Async SDK initialisation. Must be awaited before any other method is called.
   * All platform SDK bootstrap code belongs here.
   */
  init(): Promise<void>;

  /**
   * Signal that the first game frame has been rendered.
   * Implementations use this to dismiss loading splashes (e.g. `miniApp.ready()`).
   */
  ready(): void;

  // ── Identity & auth ────────────────────────────────────────────────

  getUserId(): string | null;
  getAuthScheme(): AuthScheme;
  /**
   * Raw auth payload suitable for server-side HMAC validation.
   * Telegram: `initData` query string.
   * Yandex:   player signature token.
   */
  getAuthPayload(): string | null;

  /**
   * Portal-provided display name for the local player, when the host exposes a
   * logged-in account (e.g. the CrazyGames User module). Returned synchronously
   * from a value the adapter resolved during `init()`; adapters fetch/refresh
   * it internally. Null when unavailable or the player isn't logged in — the
   * caller then falls back to the server-assigned guest name. Optional: adapters
   * without a portal account concept omit it entirely.
   */
  getUsername?(): string | null;

  // ── Game-specific integration ──────────────────────────────────────

  getLanguage(): Language | null;

  /**
   * Room code extracted from a deep-link launch.
   * Telegram: `start_param` in initData.
   * Yandex:   `environment.payload`.
   * Standalone: `?ROOM=` query param.
   */
  getLaunchRoomCode(): string | null;

  /**
   * Shareable invite URL for a private room.
   * Telegram: `https://t.me/<bot>/<app>?startapp=<code>`.
   * Yandex:   Yandex Games portal URL.
   * Standalone/Capacitor: plain `window.location` URL with `?ROOM=`.
   */
  getInviteShareUrl(roomCode: string): string;

  /**
   * Shows a fullscreen interstitial when supported.
   *
   * @param options.blocking when true, resolves only AFTER the ad is closed.
   *   Use for flows where the next action would visibly race with the ad
   *   (e.g. starting matchmaking). Default false: resolve when the ad starts,
   *   so the game can transition UI while the ad plays on top.
   *
   *   NOTE: this flag is best-effort and platform-dependent. Adapters whose
   *   underlying SDK exposes only one resolution mode ignore it — e.g. Yandex
   *   Games always resolves on close regardless of `blocking`. Callers should
   *   treat `blocking: false` as "safe to transition UI immediately" and
   *   `blocking: true` as "do not start anything that races the ad visually",
   *   not as a strict cross-platform guarantee.
   * @returns true if an ad was displayed (per SDK callback), false if skipped, unavailable, or errored.
   */
  tryShowFullscreenAd(options?: { blocking?: boolean }): Promise<boolean>;

  // ── UX features ────────────────────────────────────────────────────

  /**
   * Trigger a haptic impact.
   * IMPORTANT: must NOT be called from inside ECS Simulation.step() / System.update().
   * Emit domain events consumed outside the deterministic tick loop instead.
   */
  hapticImpact(style: 'light' | 'medium' | 'heavy'): void;

  /** Show platform back-button and register a handler. Returns an unsubscribe fn. */
  onBackButton(handler: () => void): () => void;

  /** Current safe-area insets (px). Returns zeros when not applicable. */
  getSafeAreaInsets(): SafeAreaInsets;

  /** Subscribe to safe-area changes (device rotation, fullscreen toggle, etc.). */
  onSafeAreaChange(cb: (insets: SafeAreaInsets) => void): () => void;

  /**
   * Subscribe to app-resume events (used to restore fullscreen, reconnect, etc.).
   * Fires on `visibilitychange` → visible and on Capacitor `appStateChange` → active.
   */
  onResume(cb: () => void): () => void;

  /**
   * Prevent accidental close (e.g. showing a confirmation dialog).
   * Used during an active match.
   */
  setClosingConfirmation(enabled: boolean): void;

  // ── Gameplay lifecycle (optional) ──────────────────────────────────

  /**
   * Signal that active, interactive gameplay has started (a match began).
   * Portals like CrazyGames use this to gate happy-time ads and analytics.
   * Optional: adapters without a gameplay concept omit it.
   */
  onGameplayStart?(): void;

  /**
   * Signal that active gameplay has ended (returned to menu, results, pause).
   * Must be balanced with `onGameplayStart`. Optional.
   */
  onGameplayStop?(): void;

  /**
   * Portal-driven "drop the player straight into a joinable multiplayer room"
   * signal. CrazyGames sets this when the game is launched from the Multiplayer
   * landing page or a party invite; when true, the boot flow should create a
   * fresh private room instead of showing the main menu, so friends can join
   * immediately. Adapters without this concept omit it (treated as false).
   */
  isInstantMultiplayer?(): boolean;

  // ── Multiplayer room API (optional, portal-specific) ───────────────
  //
  // These mirror the CrazyGames "Multiplayer" module. They let the portal
  // track which room the player is in, whether that room still accepts new
  // players, and how to invite friends. Adapters that don't run inside such a
  // portal (Telegram, Yandex, standalone) omit them entirely — callers reach
  // them through optional chaining, so absence is a clean no-op.

  /**
   * Room-launch params captured when the game was cold-started from an invite
   * (i.e. a friend shared a link and the invitee opened a fresh instance).
   * Returns the room code to join, or null when the launch was not an invite.
   * On CrazyGames this reads `SDK.game.inviteParams` and pulls out our room
   * code. Distinct from `getLaunchRoomCode()`, which covers the `?ROOM=` /
   * Telegram / Yandex deep-link channels; adapters must not report the same
   * launch through both to avoid double-joining.
   */
  getInviteRoomCode?(): string | null;

  /**
   * Announce to the portal that the player is now in room `roomCode` and
   * whether it currently accepts new players (`isJoinable`). Called on room
   * creation (`isJoinable: true`) and again when the room fills / the match
   * starts (`isJoinable: false`). Building the portal invite payload from the
   * room code is the adapter's responsibility.
   */
  updateRoom?(roomCode: string, isJoinable: boolean): void;

  /**
   * Announce that the player has left their current room (cancel, leave match,
   * return to menu). Clears any portal-side room/invite state. Idempotent.
   */
  leftRoom?(): void;

  /**
   * Show the portal's native "invite friends" button for `roomCode` (e.g.
   * CrazyGames renders one in its footer). Balanced by `hideInviteButton`.
   */
  showInviteButton?(roomCode: string): void;

  /** Hide the portal's native invite button. Idempotent. */
  hideInviteButton?(): void;

  /**
   * Subscribe to portal-driven "join this room now" events fired while the
   * game is already running (e.g. the player accepts a party invite without a
   * reload). The callback receives the room code to join. Returns an
   * unsubscribe fn. Adapters without live invites return a no-op unsubscribe.
   */
  onJoinRoomRequest?(cb: (roomCode: string) => void): () => void;
}
