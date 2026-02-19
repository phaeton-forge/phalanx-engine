/**
 * ITickFrameProvider - Interface for tick/frame loop providers
 *
 * This is the shared contract between:
 * - TickFrameManager (single-player, local tick generation)
 * - PhalanxClient (multiplayer, server-synchronized ticks)
 *
 * Game code should depend on this interface rather than concrete implementations,
 * allowing easy switching between single-player and multiplayer modes.
 *
 * Usage Pattern A: Single-player with TickFrameManager
 * ```typescript
 * const provider: ITickFrameProvider = new TickFrameManager({ tickRate: 60 });
 * provider.onTick((tick) => systemRegistry.processAllTicks(tick));
 * provider.onFrame((alpha, dt) => systemRegistry.updateAll(dt));
 * provider.start();
 * ```
 *
 * Usage Pattern B: Multiplayer with PhalanxClient
 * ```typescript
 * const provider: ITickFrameProvider = client; // PhalanxClient implements ITickFrameProvider
 * provider.onTick((tick, commands) => lockstepManager.processTick(tick, commands));
 * provider.onFrame((alpha, dt) => renderFrame(alpha, dt));
 * // PhalanxClient manages start/stop internally via matchmaking
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
  data?: any;
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
 * ITickFrameProvider - The minimal interface for tick/frame loop providers
 *
 * Both TickFrameManager and PhalanxClient satisfy this interface,
 * allowing game code to be written against the interface and
 * swap implementations at initialization time.
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
}

