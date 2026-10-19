/**
 * ITickFrameProvider - Interface for tick/frame loop providers
 *
 * This is the shared contract between:
 * - the single-player provider in `@phalanx-engine/runtime` (local ticks)
 * - PhalanxClient (multiplayer, server-synchronized ticks)
 *
 * Game code should depend on this interface rather than concrete implementations,
 * allowing easy switching between single-player and multiplayer modes.
 * `GameWorld` requires a provider and does not start or stop it.
 *
 * Usage Pattern A: Single-player with the runtime provider
 * ```typescript
 * const world = new GameWorld({ tickFrameProvider: provider });
 * world.registerSystems(tickSystems, frameSystems);
 * provider.start();
 * world.start();
 * ```
 *
 * Usage Pattern B: Multiplayer with PhalanxClient
 * ```typescript
 * const world = new GameWorld({ tickFrameProvider: client });
 * world.registerSystems(tickSystems, frameSystems);
 * world.start({
 *   beforeTick(tick, commands) { lockstepManager.processTick(tick, commands); },
 *   afterTick(tick) { cleanupDestroyedEntities(); },
 * });
 * ```
 */

/**
 * Commands grouped by player ID
 * In single-player mode, this will be empty.
 * In multiplayer mode, this contains commands from all players for that tick.
 */
export interface CommandsBatch {
  tick: number;
  commands: {
    [playerId: string]: PlayerCommand[];
  };
}

/**
 * A command from a specific player
 */
export interface PlayerCommand {
  type: string;
  data?: unknown;
  playerId?: string;
}

/**
 * Tick handler callback type
 * @param tick - Current simulation tick number
 * @param commands - Commands batch for this tick (empty in single-player)
 */
export type TickHandler = (tick: number, commands: CommandsBatch) => void;

/**
 * Frame handler callback type
 * @param alpha - Interpolation alpha (0-1) between previous and next tick
 * @param dt - Delta time in seconds since last frame
 */
export type FrameHandler = (alpha: number, dt: number) => void;

/**
 * Unsubscribe function returned by onTick/onFrame
 */
export type Unsubscribe = () => void;

/**
 * Pause/Resume handler callback type
 */
export type PauseHandler = () => void;

/**
 * ITickFrameProvider - The minimal interface for tick/frame loop providers
 *
 * The runtime single-player provider and PhalanxClient both satisfy this
 * interface, allowing game code to be written against the interface and
 * swap implementations at initialization time.
 *
 * The optional pause/resume methods allow GameWorld.pause()/resume() to
 * work transparently in both single-player and multiplayer:
 *
 * - **Single-player (runtime provider):** requestPause() stops the loop
 *   immediately and fires onPause handlers synchronously.
 * - **Multiplayer (PhalanxClient):** requestPause() sends a message to the
 *   server. The actual pause happens only when the server broadcasts
 *   confirmation back to all clients, ensuring deterministic freeze.
 */
export interface ITickFrameProvider {
  /**
   * Subscribe to tick updates (deterministic simulation)
   * @param handler - Called for each simulation tick
   * @returns Unsubscribe function
   */
  onTick(handler: TickHandler): Unsubscribe;

  /**
   * Subscribe to frame updates (visual rendering)
   * @param handler - Called for each render frame
   * @returns Unsubscribe function
   */
  onFrame(handler: FrameHandler): Unsubscribe;

  // ── Optional Pause / Resume ──────────────────────────────────────────

  /**
   * Request the provider to pause.
   * In single-player this is immediate; in multiplayer this sends a request
   * to the server, and the actual pause occurs when onPause fires.
   */
  requestPause?(): void;

  /**
   * Request the provider to resume.
   * Same semantics as requestPause — the actual resume is signalled via onResume.
   */
  requestResume?(): void;

  /**
   * Subscribe to the "paused" signal.
   * Fired when the provider has actually paused (after server confirmation
   * in multiplayer, or immediately in single-player).
   * @returns Unsubscribe function
   */
  onPause?(handler: PauseHandler): Unsubscribe;

  /**
   * Subscribe to the "resumed" signal.
   * @returns Unsubscribe function
   */
  onResume?(handler: PauseHandler): Unsubscribe;
}
