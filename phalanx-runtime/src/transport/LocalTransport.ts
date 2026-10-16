import type {
  CommandsBatch,
  FrameHandler,
  PauseHandler,
  PlayerCommand,
  TickHandler,
  Unsubscribe,
} from '@phalanx-engine/ecs';
import type { WireCommand } from '../game/commands.js';
import { wallClock } from '../host/wallClock.js';
import type { Transport, TransportKind } from './Transport.js';

/** How far past the next tick a submit may target (default). */
export const DEFAULT_MAX_AHEAD_TICKS = 8;

export interface LocalTransportOptions {
  /** Ticks per second; must equal `GameDefinition.tickRate`. */
  readonly tickRate: number;
  /** Clamp of a single frame's elapsed time in seconds (default 0.25). */
  readonly maxFrameTime?: number;
  /**
   * Reject `submit` when `targetTick > nextTick + maxAheadTicks`.
   * Default {@link DEFAULT_MAX_AHEAD_TICKS}. Bounds the pending map.
   */
  readonly maxAheadTicks?: number;
}

interface SlotBinding {
  readonly slot: number;
  readonly playerId: string;
}

/**
 * Offline transport: generates ticks from a local clock and loops local
 * input (humans and local bots) back into the batch of its target tick.
 * Persistence (IndexedDB) is added by Task 7 as an injected `MatchStore`.
 *
 * {@link MatchRunner} calls {@link bindSlots} so echoed batches are keyed
 * by player id. {@link manual} does not start a timer; tests advance it
 * with {@link step}.
 */
export class LocalTransport implements Transport {
  public readonly kind: TransportKind = 'local';
  public readonly isManual: boolean;
  private readonly tickRateValue: number;
  private readonly tickDuration: number;
  private readonly maxFrameTime: number;
  private readonly maxAheadTicks: number;
  private nextTick = 0;
  private readonly playerIdBySlot = new Map<number, string>();
  private readonly pending = new Map<number, Map<number, PlayerCommand[]>>();
  private clockStarted = false;
  private running = false;
  private paused = false;
  private timer: unknown = null;
  private lastTime = 0;
  private accumulator = 0;
  private tickHandlers: TickHandler[] = [];
  private frameHandlers: FrameHandler[] = [];
  private pauseHandlers: PauseHandler[] = [];
  private resumeHandlers: PauseHandler[] = [];

  public constructor(options: LocalTransportOptions, manual = false) {
    if (!Number.isInteger(options.tickRate) || options.tickRate <= 0) {
      throw new Error(
        `LocalTransport: tickRate must be a positive integer, got ${String(options.tickRate)}`
      );
    }
    const maxFrameTime = options.maxFrameTime ?? 0.25;
    if (typeof maxFrameTime !== 'number' || !(maxFrameTime > 0)) {
      throw new Error(
        `LocalTransport: maxFrameTime must be > 0, got ${String(options.maxFrameTime)}`
      );
    }
    const maxAheadTicks = options.maxAheadTicks ?? DEFAULT_MAX_AHEAD_TICKS;
    if (!Number.isInteger(maxAheadTicks) || maxAheadTicks < 0) {
      throw new Error(
        `LocalTransport: maxAheadTicks must be an integer >= 0, got ${String(options.maxAheadTicks)}`
      );
    }
    this.isManual = manual;
    this.tickRateValue = options.tickRate;
    this.tickDuration = 1 / options.tickRate;
    this.maxFrameTime = maxFrameTime;
    this.maxAheadTicks = maxAheadTicks;
  }

  /** Clock-less transport for tests and replays; advance with {@link step}. */
  public static manual(): LocalTransport {
    return new LocalTransport({ tickRate: 1 }, true);
  }

  /** Configured tick rate. Manual transports do not drive a clock from it. */
  public get tickRate(): number {
    return this.tickRateValue;
  }

  /**
   * Player id echoed in `commands-batch` for each slot. The runner binds
   * every human and bot slot before the first submit.
   */
  public bindSlots(slots: readonly SlotBinding[]): void {
    this.playerIdBySlot.clear();
    for (const binding of slots) {
      if (this.playerIdBySlot.has(binding.slot)) {
        throw new Error(
          `LocalTransport.bindSlots: duplicate slot ${String(binding.slot)}`
        );
      }
      this.playerIdBySlot.set(binding.slot, binding.playerId);
    }
  }

  /** Manual mode only: emit `count` ticks synchronously (default 1). */
  public step(count = 1): void {
    if (!this.isManual) {
      throw new Error(
        'LocalTransport.step: only a manual transport can be stepped'
      );
    }
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(
        `LocalTransport.step: count must be an integer >= 0, got ${String(count)}`
      );
    }
    for (let index = 0; index < count; index += 1) {
      if (this.paused) return;
      this.emitTick();
    }
  }

  /** Next tick that {@link step} or the timer will emit. */
  public seek(nextTick: number): void {
    if (!Number.isInteger(nextTick) || nextTick < 0) {
      throw new Error(
        `LocalTransport.seek: nextTick must be an integer >= 0, got ${String(nextTick)}`
      );
    }
    this.nextTick = nextTick;
  }

  /** Drop commands queued for a future tick. */
  public clearPending(): void {
    this.pending.clear();
  }

  public submit(
    targetTick: number,
    slot: number,
    commands: readonly WireCommand[]
  ): void {
    if (!Number.isInteger(targetTick) || targetTick < 0) {
      throw new Error(
        `LocalTransport.submit: targetTick must be an integer >= 0, got ${String(targetTick)}`
      );
    }
    if (targetTick < this.nextTick) {
      throw new Error(
        `LocalTransport.submit: target tick ${String(targetTick)} is already past (next ${String(this.nextTick)})`
      );
    }
    if (targetTick > this.nextTick + this.maxAheadTicks) {
      throw new Error(
        `LocalTransport.submit: target tick ${String(targetTick)} is more than ${String(this.maxAheadTicks)} ticks ahead of ${String(this.nextTick)}`
      );
    }
    const playerId = this.playerIdBySlot.get(slot);
    if (playerId === undefined) {
      throw new Error(
        `LocalTransport.submit: slot ${String(slot)} is not bound`
      );
    }
    let bySlot = this.pending.get(targetTick);
    if (bySlot === undefined) {
      bySlot = new Map();
      this.pending.set(targetTick, bySlot);
    }
    const queued = bySlot.get(slot) ?? [];
    for (const command of commands) {
      queued.push({
        type: command.type,
        data: command.data,
        playerId,
      });
    }
    bySlot.set(slot, queued);
  }

  /** Start the timer. Manual transports record the request and do not tick. */
  public start(): void {
    this.clockStarted = true;
    if (this.isManual || this.paused || this.running) return;
    this.running = true;
    this.lastTime = hostNowSeconds();
    this.accumulator = 0;
    this.schedule();
  }

  /** Stop the timer. Does not reset the tick counter. */
  public stop(): void {
    this.running = false;
    this.clockStarted = false;
    this.cancelTimer();
  }

  public onTick(handler: TickHandler): Unsubscribe {
    this.tickHandlers.push(handler);
    return () => {
      this.remove(this.tickHandlers, handler);
    };
  }

  public onFrame(handler: FrameHandler): Unsubscribe {
    this.frameHandlers.push(handler);
    return () => {
      this.remove(this.frameHandlers, handler);
    };
  }

  public requestPause(): void {
    if (this.paused) return;
    this.paused = true;
    this.running = false;
    this.cancelTimer();
    for (const handler of this.pauseHandlers.slice()) handler();
  }

  public requestResume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const handler of this.resumeHandlers.slice()) handler();
    if (this.clockStarted && !this.isManual) this.start();
  }

  public onPause(handler: PauseHandler): Unsubscribe {
    this.pauseHandlers.push(handler);
    return () => {
      this.remove(this.pauseHandlers, handler);
    };
  }

  public onResume(handler: PauseHandler): Unsubscribe {
    this.resumeHandlers.push(handler);
    return () => {
      this.remove(this.resumeHandlers, handler);
    };
  }

  public dispose(): void {
    this.stop();
    this.tickHandlers = [];
    this.frameHandlers = [];
    this.pauseHandlers = [];
    this.resumeHandlers = [];
    this.pending.clear();
  }

  private emitTick(): void {
    const tick = this.nextTick;
    this.nextTick += 1;
    const batch = this.takeBatch(tick);
    for (const handler of this.tickHandlers.slice()) handler(tick, batch);
  }

  private takeBatch(tick: number): CommandsBatch {
    // Player ids are arbitrary strings. A null prototype keeps
    // `__proto__` and `constructor` as own data properties.
    const commands = emptyCommands();
    const bySlot = this.pending.get(tick);
    if (bySlot !== undefined) {
      const slots = [...bySlot.keys()].sort((a, b) => a - b);
      for (const slot of slots) {
        const playerId = this.playerIdBySlot.get(slot);
        const queued = bySlot.get(slot);
        if (playerId === undefined || queued === undefined) continue;
        commands[playerId] = queued.slice();
      }
      this.pending.delete(tick);
    }
    return { tick, commands };
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    hostClearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.running || this.paused) return;
    const waitSeconds = this.tickDuration - this.accumulator;
    const waitMs = waitSeconds > 0 ? waitSeconds * 1000 : 0;
    this.timer = hostSetTimeout(this.onTimer, waitMs);
  }

  private readonly onTimer = (): void => {
    this.timer = null;
    if (!this.running || this.paused) return;
    try {
      this.advanceClock();
    } catch {
      this.stop();
      return;
    }
    this.schedule();
  };

  private advanceClock(): void {
    const now = hostNowSeconds();
    let frameTime = now - this.lastTime;
    this.lastTime = now;
    if (frameTime > this.maxFrameTime) frameTime = this.maxFrameTime;
    if (frameTime < 0) frameTime = 0;
    this.accumulator += frameTime;
    while (this.accumulator >= this.tickDuration) {
      if (!this.running || this.paused) return;
      this.emitTick();
      this.accumulator -= this.tickDuration;
    }
    if (!this.running || this.paused) return;
    const alpha =
      this.tickDuration === 0 ? 0 : this.accumulator / this.tickDuration;
    for (const handler of this.frameHandlers.slice()) {
      handler(alpha, frameTime);
    }
  }

  private remove<T>(handlers: T[], handler: T): void {
    const index = handlers.indexOf(handler);
    if (index !== -1) handlers.splice(index, 1);
  }
}

function emptyCommands(): { [playerId: string]: PlayerCommand[] } {
  return Object.create(null) as { [playerId: string]: PlayerCommand[] };
}

function hostSetTimeout(handler: () => void, timeout: number): unknown {
  return wallClock().setTimeout(handler, timeout);
}

function hostClearTimeout(handle: unknown): void {
  wallClock().clearTimeout(handle);
}

function hostNowSeconds(): number {
  return wallClock().performance.now() / 1000;
}
