import type {
  CommandsBatch,
  FrameHandler,
  PauseHandler,
  TickHandler,
  Unsubscribe,
} from '../transport/providerTypes.js';
import type { TransportCommand } from '../game/commands.js';
import type { Transport, TransportKind } from '../transport/Transport.js';
import type { SimCommand } from './messages.js';

interface SubmittedBotCommand {
  readonly tick: number;
  readonly slot: number;
  readonly commands: readonly TransportCommand[];
}

/**
 * Tick source for one server `MatchRunner`. The relay delivers stamped
 * batches; bot submits are reported outward and are not echoed locally.
 * `system` commands injected ahead of a batch are merged in once.
 */
export class RelayFeedTransport implements Transport {
  public readonly kind: TransportKind = 'server-peer';
  private readonly tickHandlers: TickHandler[] = [];
  private readonly frameHandlers: FrameHandler[] = [];
  private readonly pauseHandlers: PauseHandler[] = [];
  private readonly resumeHandlers: PauseHandler[] = [];
  private readonly injected = new Map<number, SimCommand[]>();
  private paused = false;
  private readonly pendingSubmit: SubmittedBotCommand[] = [];

  /** Bot submits captured by the most recent {@link deliver}. */
  public takeSubmitted(): SubmittedBotCommand[] {
    return this.pendingSubmit.splice(0, this.pendingSubmit.length);
  }

  /**
   * Hold a system command until `tick` is delivered. A command the batch
   * already contains (same player and envelope `q`) is not duplicated.
   */
  public inject(command: SimCommand): void {
    const list = this.injected.get(command.tick) ?? [];
    list.push(command);
    this.injected.set(command.tick, list);
  }

  public deliver(tick: number, commands: readonly SimCommand[]): void {
    const extra = this.injected.get(tick) ?? [];
    this.injected.delete(tick);
    const batch = toBatch(tick, mergeCommands(commands, extra));
    for (const handler of this.tickHandlers.slice()) {
      handler(tick, batch);
    }
  }

  public submit(
    targetTick: number,
    slot: number,
    commands: readonly TransportCommand[]
  ): void {
    this.pendingSubmit.push({
      tick: targetTick,
      slot,
      commands: commands.slice(),
    });
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
    for (const handler of this.pauseHandlers.slice()) handler();
  }

  public requestResume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const handler of this.resumeHandlers.slice()) handler();
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
    this.tickHandlers.length = 0;
    this.frameHandlers.length = 0;
    this.pauseHandlers.length = 0;
    this.resumeHandlers.length = 0;
    this.injected.clear();
    this.pendingSubmit.length = 0;
  }

  private remove(list: unknown[], handler: unknown): void {
    const index = list.indexOf(handler);
    if (index !== -1) list.splice(index, 1);
  }
}

function mergeCommands(
  commands: readonly SimCommand[],
  extra: readonly SimCommand[]
): SimCommand[] {
  const seen = new Set(commands.map(commandKey));
  const merged = commands.slice();
  for (const command of extra) {
    const key = commandKey(command);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(command);
  }
  return merged;
}

function commandKey(command: SimCommand): string {
  return `${command.playerId}:${String(envelopeSeq(command.data))}`;
}

function envelopeSeq(data: unknown): number {
  if (typeof data !== 'object' || data === null) return 0;
  const seq = (data as { q?: unknown }).q;
  return typeof seq === 'number' && Number.isInteger(seq) ? seq : 0;
}

function toBatch(tick: number, commands: readonly SimCommand[]): CommandsBatch {
  const map = Object.create(null) as CommandsBatch['commands'];
  for (const command of commands) {
    const list = map[command.playerId] ?? [];
    list.push({
      type: command.type,
      playerId: command.playerId,
      data: command.data,
    });
    map[command.playerId] = list;
  }
  return { tick, commands: map };
}
