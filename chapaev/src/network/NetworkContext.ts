import { NetworkManager } from './NetworkManager.ts';

/**
 * Holds the (replaceable) `NetworkManager` plus the shared book-keeping
 * for one-shot connection-phase listeners that several coordinators
 * register during matchmaking / private-room flows.
 *
 * `Game` and all coordinators share a single instance: when the user
 * returns to the menu we `replace()` the manager in place so callers
 * reading `ctx.manager` automatically pick up the fresh one without
 * needing to be re-instantiated.
 */
export class NetworkContext {
  public manager: NetworkManager;
  private connectListenerUnsubs: (() => void)[] = [];

  constructor() {
    this.manager = new NetworkManager();
  }

  /** Replace the underlying manager (e.g. on returnToMainMenu). */
  replace(): NetworkManager {
    this.cleanupConnectListeners();
    this.manager.dispose();
    this.manager = new NetworkManager();
    return this.manager;
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
