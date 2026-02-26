/**
 * TickFrameManager - No-op client for single-player games
 *
 * Provides tick-based simulation and frame-based rendering loops
 * without network synchronization. Can be replaced by PhalanxClient
 * for multiplayer games.
 *
 * Implements ITickFrameProvider so it can be used interchangeably with
 * PhalanxClient in game code.
 *
 * Features:
 * - Fixed timestep simulation (deterministic ticks)
 * - Variable timestep rendering (smooth frames)
 * - Frame interpolation alpha for smooth visuals between ticks
 */

import type {
  ITickFrameProvider,
  TickHandler,
  FrameHandler,
  Unsubscribe,
  CommandsBatch,
  PauseHandler,
} from './ITickFrameProvider';

export interface TickFrameManagerConfig {
  /** Target ticks per second (default: 60) */
  tickRate?: number;
  /** Maximum time per frame in seconds to prevent spiral of death (default: 0.25) */
  maxFrameTime?: number;
}

export class TickFrameManager implements ITickFrameProvider {
  private tickRate: number;
  private tickDuration: number; // Duration of one tick in seconds
  private maxFrameTime: number;

  private tickCallbacks: TickHandler[] = [];
  private frameCallbacks: FrameHandler[] = [];
  private pauseHandlers: PauseHandler[] = [];
  private resumeHandlers: PauseHandler[] = [];

  private currentTick: number = 0;
  private accumulator: number = 0;
  private lastTime: number = 0;
  private isRunning: boolean = false;
  private _isPaused: boolean = false;
  private rafId: number | null = null;

  constructor(config?: TickFrameManagerConfig) {
    this.tickRate = config?.tickRate ?? 60;
    this.tickDuration = 1.0 / this.tickRate;
    this.maxFrameTime = config?.maxFrameTime ?? 0.25;
  }

  /**
   * Subscribe to tick updates (deterministic simulation)
   * In single-player mode, the CommandsBatch will be empty.
   * @param callback - Called for each simulation tick with tick number and empty commands batch
   * @returns Unsubscribe function
   */
  public onTick(callback: TickHandler): Unsubscribe {
    this.tickCallbacks.push(callback);
    return () => {
      const index = this.tickCallbacks.indexOf(callback);
      if (index !== -1) {
        this.tickCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to frame updates (visual rendering)
   * @param callback - Called for each render frame with alpha and deltaTime
   * @returns Unsubscribe function
   */
  public onFrame(callback: FrameHandler): Unsubscribe {
    this.frameCallbacks.push(callback);
    return () => {
      const index = this.frameCallbacks.indexOf(callback);
      if (index !== -1) {
        this.frameCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Start the tick/frame loop
   */
  public start(): void {
    if (this.isRunning) {
      console.warn('[TickFrameManager] Already running');
      return;
    }

    this.isRunning = true;
    this.lastTime = performance.now() / 1000; // Convert to seconds
    this.accumulator = 0;

    this.loop();
  }

  /**
   * Stop the tick/frame loop
   */
  public stop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Main game loop using fixed timestep for simulation and variable timestep for rendering
   * Based on "Fix Your Timestep" by Glenn Fiedler
   */
  private loop = (): void => {
    if (!this.isRunning) return;

    const currentTime = performance.now() / 1000; // Convert to seconds
    let frameTime = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Prevent spiral of death by capping frame time
    if (frameTime > this.maxFrameTime) {
      frameTime = this.maxFrameTime;
    }

    this.accumulator += frameTime;

    // Process simulation ticks (fixed timestep)
    while (this.accumulator >= this.tickDuration) {
      // Create empty commands batch for single-player mode
      const emptyBatch: CommandsBatch = {
        tick: this.currentTick,
        commands: {},
      };

      // Execute all tick callbacks
      for (const callback of this.tickCallbacks) {
        callback(this.currentTick, emptyBatch);
      }

      this.currentTick++;
      this.accumulator -= this.tickDuration;
    }

    // Calculate interpolation alpha for smooth rendering between ticks
    // Alpha represents how far between the previous tick and next tick we are
    // 0.0 = at previous tick position, 1.0 = at next tick position
    const alpha = this.accumulator / this.tickDuration;

    // Execute all frame callbacks with alpha and frame time
    for (const callback of this.frameCallbacks) {
      callback(alpha, frameTime);
    }

    // Schedule next frame
    this.rafId = requestAnimationFrame(this.loop);
  };

  // ── Pause / Resume (ITickFrameProvider optional methods) ─────────────

  /**
   * Pause the loop immediately and notify all onPause subscribers.
   */
  public requestPause(): void {
    if (this._isPaused) return;
    this._isPaused = true;
    this.stop();
    for (const handler of this.pauseHandlers) handler();
  }

  /**
   * Resume the loop immediately and notify all onResume subscribers.
   */
  public requestResume(): void {
    if (!this._isPaused) return;
    this._isPaused = false;
    this.start();
    for (const handler of this.resumeHandlers) handler();
  }

  /**
   * Subscribe to "paused" events.
   */
  public onPause(handler: PauseHandler): Unsubscribe {
    this.pauseHandlers.push(handler);
    return () => {
      const idx = this.pauseHandlers.indexOf(handler);
      if (idx !== -1) this.pauseHandlers.splice(idx, 1);
    };
  }

  /**
   * Subscribe to "resumed" events.
   */
  public onResume(handler: PauseHandler): Unsubscribe {
    this.resumeHandlers.push(handler);
    return () => {
      const idx = this.resumeHandlers.indexOf(handler);
      if (idx !== -1) this.resumeHandlers.splice(idx, 1);
    };
  }

  /**
   * Get the current tick number
   */
  public getCurrentTick(): number {
    return this.currentTick;
  }

  /**
   * Get the configured tick rate
   */
  public getTickRate(): number {
    return this.tickRate;
  }

  /**
   * Check if the manager is running
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Dispose and cleanup
   */
  public dispose(): void {
    this.stop();
    this.tickCallbacks = [];
    this.frameCallbacks = [];
    this.pauseHandlers = [];
    this.resumeHandlers = [];
  }
}
