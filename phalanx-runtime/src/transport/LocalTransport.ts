import type {
  CommandsBatch,
  FrameHandler,
  PauseHandler,
  PlayerCommand,
  TickHandler,
  Unsubscribe,
} from '@phalanx-engine/ecs';
import { DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS } from '../constants.js';
import type { WireCommand } from '../game/commands.js';
import { wallClock } from '../host/wallClock.js';
import type { MatchStore } from '../persistence/MatchStore.js';
import type { Transport, TransportKind } from './Transport.js';

/** How far past the next tick a submit may target (default). */
export const DEFAULT_MAX_AHEAD_TICKS = 8;

/** How often a stored match flushes its command tail and snapshots. */
const PERSIST_FLUSH_MS = 5000;

/** Why a {@link LocalTransport} asked the runner to flush its journal. */
export type PersistenceFlushReason = 'timer' | 'hide' | 'pagehide' | 'stop';

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
  /**
   * When set, the runner journals this match. Omitted: today's transport,
   * with no snapshots and no command log on disk.
   */
  readonly store?: MatchStore;
  /**
   * Completed ticks between sealed snapshots. Default
   * {@link DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS} (300). Tick 0 is never a
   * snapshot.
   */
  readonly snapshotEveryTicks?: number;
  /**
   * Pause the clock when the document is hidden. Default `true`. A host
   * with no `document` ignores it. Becoming visible does not resume.
   */
  readonly pauseWhenHidden?: boolean;
}

interface SlotBinding {
  readonly slot: number;
  readonly playerId: string;
}

/**
 * Offline transport: generates ticks from a local clock and loops local
 * input (humans and local bots) back into the batch of its target tick.
 * An optional {@link MatchStore} journals the match. Writes are batched
 * every 5s and on hide / pagehide; the transport never awaits them.
 *
 * {@link MatchRunner} calls {@link bindSlots} so echoed batches are keyed
 * by player id. {@link stepped} does not start a timer; tests advance it
 * with {@link step}.
 */
export class LocalTransport implements Transport {
  public readonly kind: TransportKind = 'local';
  public readonly isStepped: boolean;
  private readonly tickRateValue: number;
  private readonly tickDuration: number;
  private readonly maxFrameTime: number;
  private readonly maxAheadTicks: number;
  private readonly store: MatchStore | undefined;
  private readonly snapshotEvery: number;
  private readonly pauseWhenHidden: boolean;
  private nextTick = 0;
  private readonly playerIdBySlot = new Map<number, string>();
  private readonly pending = new Map<number, Map<number, PlayerCommand[]>>();
  private clockStarted = false;
  private running = false;
  private paused = false;
  private timer: unknown = null;
  private persistTimer: unknown = null;
  private lastTime = 0;
  private accumulator = 0;
  private tickHandlers: TickHandler[] = [];
  private frameHandlers: FrameHandler[] = [];
  private pauseHandlers: PauseHandler[] = [];
  private resumeHandlers: PauseHandler[] = [];
  private persistHandlers: Array<(reason: PersistenceFlushReason) => void> = [];
  private visibilityTarget: EventTargetLike | null = null;
  private pageTarget: EventTargetLike | null = null;

  public constructor(options: LocalTransportOptions, stepped = false) {
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
    const snapshotEvery =
      options.snapshotEveryTicks ?? DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS;
    if (!Number.isInteger(snapshotEvery) || snapshotEvery < 1) {
      throw new Error(
        `LocalTransport: snapshotEveryTicks must be an integer >= 1, got ${String(options.snapshotEveryTicks)}`
      );
    }
    const pauseWhenHidden = options.pauseWhenHidden ?? true;
    if (typeof pauseWhenHidden !== 'boolean') {
      throw new Error(
        `LocalTransport: pauseWhenHidden must be a boolean, got ${String(options.pauseWhenHidden)}`
      );
    }
    this.isStepped = stepped;
    this.tickRateValue = options.tickRate;
    this.tickDuration = 1 / options.tickRate;
    this.maxFrameTime = maxFrameTime;
    this.maxAheadTicks = maxAheadTicks;
    this.store = options.store;
    this.snapshotEvery = snapshotEvery;
    this.pauseWhenHidden = pauseWhenHidden;
    this.bindHostEvents();
  }

  /**
   * Clock-less transport for tests and replays; advance with {@link step}.
   * `tickRate` defaults to 1 and is not a clock.
   */
  public static stepped(
    options?: Partial<LocalTransportOptions>
  ): LocalTransport {
    return new LocalTransport({ tickRate: 1, ...options }, true);
  }

  /** Configured tick rate. A stepped transport does not drive a clock from it. */
  public get tickRate(): number {
    return this.tickRateValue;
  }

  /** Store passed at construction, if persistence is on. */
  public get matchStore(): MatchStore | undefined {
    return this.store;
  }

  /** Interval used when a store is sealing snapshots. */
  public get snapshotEveryTicks(): number {
    return this.snapshotEvery;
  }

  /**
   * Player id echoed in `commands-batch` for each slot. The runner binds
   * every human and bot slot before the first submit. A later
   * {@link assignPlayerId} changes the id stamped on commands submitted
   * after a controller change.
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

  /**
   * Stamp later submits for `slot` with `playerId`. Commands already queued
   * keep the id they were stamped with.
   */
  public assignPlayerId(slot: number, playerId: string): void {
    if (!this.playerIdBySlot.has(slot)) {
      throw new Error(
        `LocalTransport.assignPlayerId: slot ${String(slot)} is not bound`
      );
    }
    this.playerIdBySlot.set(slot, playerId);
  }

  /** Stepped mode only: emit `count` ticks synchronously (default 1). */
  public step(count = 1): void {
    if (!this.isStepped) {
      throw new Error(
        'LocalTransport.step: only a stepped transport can be stepped'
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

  /**
   * Called when the journal should write. `hide` and `pagehide` are urgent.
   * `timer` and `stop` are not: the digest stays off the tick that stopped
   * the match.
   */
  public onPersistenceFlush(
    handler: (reason: PersistenceFlushReason) => void
  ): Unsubscribe {
    this.persistHandlers.push(handler);
    return () => {
      this.remove(this.persistHandlers, handler);
    };
  }

  /**
   * Start the timer. A stepped transport records the request and does not
   * tick. A hidden document pauses instead of starting the clock.
   */
  public start(): void {
    this.clockStarted = true;
    if (this.pauseWhenHidden && this.isHidden()) this.requestPause();
    this.armPersistTimer();
    if (this.isStepped || this.paused || this.running) return;
    this.running = true;
    this.lastTime = hostNowSeconds();
    this.accumulator = 0;
    this.schedule();
  }

  /** Stop the timer and ask for a non-urgent flush. Does not reset the tick. */
  public stop(): void {
    this.running = false;
    this.clockStarted = false;
    this.cancelTimer();
    this.cancelPersistTimer();
    this.emitFlush('stop');
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
    if (this.clockStarted && !this.isStepped) this.start();
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
    this.detachHostEvents();
    this.stop();
    this.tickHandlers = [];
    this.frameHandlers = [];
    this.pauseHandlers = [];
    this.resumeHandlers = [];
    this.persistHandlers = [];
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
      const slots = [...bySlot.keys()].sort((left, right) => left - right);
      for (const slot of slots) {
        const queued = bySlot.get(slot);
        if (queued === undefined) continue;
        for (const command of queued) {
          const playerId = command.playerId;
          if (playerId === undefined) continue;
          const list = commands[playerId];
          if (list === undefined) commands[playerId] = [command];
          else list.push(command);
        }
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

  private armPersistTimer(): void {
    if (this.store === undefined || this.persistTimer !== null) return;
    this.persistTimer = hostSetTimeout(this.onPersistTimer, PERSIST_FLUSH_MS);
  }

  private cancelPersistTimer(): void {
    if (this.persistTimer === null) return;
    hostClearTimeout(this.persistTimer);
    this.persistTimer = null;
  }

  private readonly onPersistTimer = (): void => {
    this.persistTimer = null;
    this.emitFlush('timer');
    if (this.clockStarted) this.armPersistTimer();
  };

  private emitFlush(reason: PersistenceFlushReason): void {
    if (this.store === undefined) return;
    for (const handler of this.persistHandlers.slice()) handler(reason);
  }

  private bindHostEvents(): void {
    if (!this.pauseWhenHidden && this.store === undefined) return;
    const doc = hostDocument();
    if (doc !== null) {
      doc.addEventListener('visibilitychange', this.onVisibility);
      this.visibilityTarget = doc;
    }
    if (this.store === undefined) return;
    const page = hostPageTarget();
    if (page === null || page === doc) {
      if (doc !== null) {
        doc.addEventListener('pagehide', this.onPageHide);
        this.pageTarget = doc;
      }
      return;
    }
    page.addEventListener('pagehide', this.onPageHide);
    this.pageTarget = page;
  }

  private detachHostEvents(): void {
    this.visibilityTarget?.removeEventListener(
      'visibilitychange',
      this.onVisibility
    );
    this.visibilityTarget = null;
    this.pageTarget?.removeEventListener('pagehide', this.onPageHide);
    this.pageTarget = null;
  }

  private readonly onVisibility = (): void => {
    if (!this.isHidden()) return;
    // Catch-up runs before start(). Pausing then skips systems on the
    // rebuilt world and the resumed state diverges.
    if (this.pauseWhenHidden && this.clockStarted) this.requestPause();
    if (this.store !== undefined) this.emitFlush('hide');
  };

  private readonly onPageHide = (): void => {
    this.emitFlush('pagehide');
  };

  private isHidden(): boolean {
    return documentVisibility() === 'hidden';
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

interface EventTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

function hostDocument(): EventTargetLike | null {
  return eventTarget(readHostProperty('document'));
}

function hostPageTarget(): EventTargetLike | null {
  return eventTarget(globalThis);
}

function documentVisibility(): string | null {
  const doc = readHostProperty('document');
  if (!isRecord(doc)) return null;
  const state = doc['visibilityState'];
  return typeof state === 'string' ? state : null;
}

function readHostProperty(key: string): unknown {
  const host: unknown = globalThis;
  if (!isRecord(host)) return undefined;
  return host[key];
}

function eventTarget(value: unknown): EventTargetLike | null {
  if (!isRecord(value)) return null;
  const add = value['addEventListener'];
  const remove = value['removeEventListener'];
  if (typeof add !== 'function' || typeof remove !== 'function') return null;
  const target = value;
  return {
    addEventListener(type: string, listener: () => void): void {
      add.call(target, type, listener);
    },
    removeEventListener(type: string, listener: () => void): void {
      remove.call(target, type, listener);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
