import {
  NetworkManager,
  type NetworkManagerOptions,
} from './NetworkManager.ts';

/**
 * Holds the (replaceable) `NetworkManager` plus the shared book-keeping
 * for one-shot connection-phase listeners that several coordinators
 * register during matchmaking / private-room flows.
 *
 * `Game` and all coordinators share a single instance: when the user
 * returns to the menu we `replace()` the manager in place so callers
 * reading `ctx.manager` automatically pick up the fresh one without
 * needing to be re-instantiated.
 *
 * Options are resolved lazily via a provider callback so late-arriving
 * data (e.g. a CrazyGames username that lands after the player logs in
 * mid-session) is picked up on the next connect/`replace()` instead of
 * being frozen at construction time.
 */
export type NetworkOptionsProvider =
  | NetworkManagerOptions
  | (() => NetworkManagerOptions);

export class NetworkContext {
  public manager: NetworkManager;
  private connectListenerUnsubs: (() => void)[] = [];
  private replaceHandlers: (() => void)[] = [];
  private readonly resolveOptions: () => NetworkManagerOptions;

  constructor(options: NetworkOptionsProvider = {}) {
    this.resolveOptions =
      typeof options === 'function' ? options : () => options;
    this.manager = new NetworkManager(this.resolveOptions());
  }

  /** Replace the underlying manager (e.g. on returnToMainMenu). */
  replace(): NetworkManager {
    this.cleanupConnectListeners();
    this.manager.dispose();
    this.manager = new NetworkManager(this.resolveOptions());
    for (const handler of this.replaceHandlers) handler();
    return this.manager;
  }

  /** Subscribe to manager replacements (e.g. RoomRecoveryManager re-binds here). */
  onReplace(handler: () => void): () => void {
    this.replaceHandlers.push(handler);
    return () => {
      const idx = this.replaceHandlers.indexOf(handler);
      if (idx !== -1) this.replaceHandlers.splice(idx, 1);
    };
  }

  /** Track a `client.on(...)` unsub registered during a connect phase. */
  trackConnectListener(unsub: () => void): void {
    this.connectListenerUnsubs.push(unsub);
  }

  cleanupConnectListeners(): void {
    for (const u of this.connectListenerUnsubs) u();
    this.connectListenerUnsubs = [];
  }

  dispose(): void {
    this.cleanupConnectListeners();
    this.manager.dispose();
  }
}
