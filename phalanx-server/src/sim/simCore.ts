import {
  MatchRunner,
  botPlayerId,
  type AnyGameDefinition,
  type MatchOutcome,
} from '@phalanx-engine/runtime';
import { RelayFeedTransport } from './RelayFeedTransport.js';
import {
  errorMessage,
  simFaultKind,
  type SimCommand,
  type SimIn,
  type SimOut,
  type SimOutcome,
} from './messages.js';

export interface SimSink {
  send(message: SimOut): void;
}

interface LiveMatch {
  runner: MatchRunner<AnyGameDefinition>;
  transport: RelayFeedTransport;
  snapshotEvery: number;
  failed: boolean;
  ended: boolean;
  reported: boolean;
  pendingSnapshots: number[];
}

/**
 * One process of server matches. The worker and the in-process host both
 * drive this queue. Messages for a match run one at a time.
 */
export class SimProcess {
  private readonly matches = new Map<string, LiveMatch>();
  private readonly games = new Map<string, AnyGameDefinition>();
  private readonly inline = new Map<string, AnyGameDefinition>();
  private readonly queue: SimIn[] = [];
  private running = false;
  private closed = false;
  private idle: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;

  public constructor(
    private readonly sink: SimSink,
    private readonly options: { readonly yieldBetween: boolean }
  ) {}

  /** In-process games that were configured as objects, keyed by id. */
  public install(definition: AnyGameDefinition): void {
    this.inline.set(definition.id, definition);
  }

  public push(message: SimIn): void {
    if (this.closed && message.t !== 'close') return;
    this.queue.push(message);
    this.kick();
  }

  /** Resolves when every message pushed so far has been handled. */
  public whenIdle(): Promise<void> {
    return this.idle;
  }

  private kick(): void {
    if (this.running) return;
    this.idle = new Promise<void>((resolve) => {
      this.idleResolve = resolve;
    });
    void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (message === undefined) break;
      try {
        await this.handle(message);
      } catch (error) {
        this.failMessage(message, error);
      }
      if (this.options.yieldBetween && this.queue.length > 0) {
        await new Promise<void>((resolve) => {
          setImmediate(resolve);
        });
      }
    }
    this.running = false;
    const resolve = this.idleResolve;
    this.idleResolve = null;
    resolve?.();
    if (this.queue.length > 0) this.kick();
  }

  private async handle(message: SimIn): Promise<void> {
    switch (message.t) {
      case 'open':
        await this.open(message);
        return;
      case 'batch':
        this.batch(message);
        return;
      case 'snapshot':
        this.snapshot(message.matchId, message.requestId);
        return;
      case 'setController':
        this.controller(message.matchId, message.command);
        return;
      case 'end':
        this.end(message.matchId);
        return;
      case 'close':
        this.close();
        return;
      default:
        return;
    }
  }

  private async open(message: Extract<SimIn, { t: 'open' }>): Promise<void> {
    if (this.matches.has(message.matchId)) {
      this.fault(message.matchId, 'sim-error', 'match already open');
      return;
    }
    const definition = await this.load(
      message.module,
      message.exportName,
      readGameId(message.config)
    );
    const transport = new RelayFeedTransport();
    let runner: MatchRunner<AnyGameDefinition>;
    try {
      // Wire JSON. MatchRunner validates identity, seed, slots and delay.
      runner = new MatchRunner(definition, message.config as never, transport, {
        hashEveryTicks: message.hashEveryTicks,
      });
    } catch (error) {
      transport.dispose();
      this.fault(message.matchId, 'sim-error', errorMessage(error));
      return;
    }
    const live: LiveMatch = {
      runner,
      transport,
      snapshotEvery: message.snapshotEveryTicks,
      failed: false,
      ended: false,
      reported: false,
      pendingSnapshots: [],
    };
    runner.onDigest((tick, digest) => {
      this.sink.send({ t: 'digest', matchId: message.matchId, tick, digest });
    });
    runner.onOutcome((outcome) => {
      live.ended = true;
      this.sink.send({
        t: 'event',
        matchId: message.matchId,
        outcome: toOutcome(outcome),
      });
    });
    runner.onError((error) => {
      if (live.reported) return;
      live.reported = true;
      live.failed = true;
      this.fault(message.matchId, simFaultKind(error), errorMessage(error));
    });
    try {
      runner.start();
    } catch (error) {
      runner.dispose();
      this.fault(message.matchId, simFaultKind(error), errorMessage(error));
      return;
    }
    this.matches.set(message.matchId, live);
    this.sink.send({ t: 'opened', matchId: message.matchId });
  }

  private batch(message: Extract<SimIn, { t: 'batch' }>): void {
    const live = this.matches.get(message.matchId);
    if (live === undefined || live.failed || live.ended) return;
    try {
      live.transport.deliver(message.tick, message.commands);
    } catch (error) {
      if (!live.reported) {
        live.reported = true;
        live.failed = true;
        this.fault(message.matchId, simFaultKind(error), errorMessage(error));
      }
      live.runner.dispose();
      this.matches.delete(message.matchId);
      return;
    }
    this.publishBots(message.matchId, live);
    try {
      live.runner.flush();
    } catch (error) {
      if (!live.reported) {
        live.reported = true;
        live.failed = true;
        this.fault(message.matchId, simFaultKind(error), errorMessage(error));
      }
      return;
    }
    this.sink.send({
      t: 'tick',
      matchId: message.matchId,
      tick: message.tick,
    });
    if (
      message.tick > 0 &&
      live.snapshotEvery > 0 &&
      message.tick % live.snapshotEvery === 0
    ) {
      this.emitSnapshot(message.matchId, live, undefined);
    }
    const waiting = live.pendingSnapshots.splice(
      0,
      live.pendingSnapshots.length
    );
    for (const requestId of waiting) {
      this.emitSnapshot(message.matchId, live, requestId);
    }
  }

  private publishBots(matchId: string, live: LiveMatch): void {
    const byTick = new Map<number, SimCommand[]>();
    for (const submitted of live.transport.takeSubmitted()) {
      const playerId = botPlayerId(submitted.slot);
      const list = byTick.get(submitted.tick) ?? [];
      for (const command of submitted.commands) {
        list.push({
          type: command.type,
          tick: submitted.tick,
          playerId,
          data: command.data,
        });
      }
      byTick.set(submitted.tick, list);
    }
    const ticks = [...byTick.keys()].sort((left, right) => left - right);
    for (const tick of ticks) {
      const commands = byTick.get(tick);
      if (commands === undefined) continue;
      this.sink.send({ t: 'botCommands', matchId, tick, commands });
    }
  }

  private snapshot(matchId: string, requestId: number): void {
    const live = this.matches.get(matchId);
    if (live === undefined || live.failed) return;
    if (live.runner.tick < 0) {
      live.pendingSnapshots.push(requestId);
      return;
    }
    this.emitSnapshot(matchId, live, requestId);
  }

  private emitSnapshot(
    matchId: string,
    live: LiveMatch,
    requestId: number | undefined
  ): void {
    let bytes: Uint8Array;
    try {
      bytes = live.runner.snapshot();
    } catch (error) {
      this.fault(matchId, 'sim-error', errorMessage(error));
      return;
    }
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    const message: SimOut = {
      t: 'snapshot',
      matchId,
      tick: live.runner.tick,
      bytes: copy,
    };
    if (requestId !== undefined) {
      this.sink.send({ ...message, requestId });
      return;
    }
    this.sink.send(message);
  }

  private controller(matchId: string, command: SimCommand): void {
    const live = this.matches.get(matchId);
    if (live === undefined || live.failed || live.ended) return;
    live.transport.inject(command);
  }

  private end(matchId: string): void {
    const live = this.matches.get(matchId);
    if (live === undefined) {
      this.sink.send({ t: 'ended', matchId });
      return;
    }
    this.matches.delete(matchId);
    live.runner.dispose();
    this.sink.send({ t: 'ended', matchId });
  }

  private close(): void {
    this.closed = true;
    for (const matchId of [...this.matches.keys()]) {
      this.end(matchId);
    }
  }

  private fault(
    matchId: string,
    kind: 'sim-error' | 'sim-crash' | 'sim-oom',
    message: string
  ): void {
    this.sink.send({ t: kind, matchId, message });
  }

  private failMessage(message: SimIn, error: unknown): void {
    if (message.t === 'close') return;
    const matchId = 'matchId' in message ? message.matchId : '';
    if (matchId.length === 0) return;
    const live = this.matches.get(matchId);
    if (live !== undefined) {
      live.failed = true;
      live.runner.dispose();
      this.matches.delete(matchId);
    }
    this.fault(matchId, simFaultKind(error), errorMessage(error));
  }

  private async load(
    modulePath: string,
    exportName: string | undefined,
    gameId: string
  ): Promise<AnyGameDefinition> {
    const installed = this.inline.get(gameId);
    if (installed !== undefined) return installed;
    const key = `${modulePath}#${exportName ?? ''}`;
    const cached = this.games.get(key);
    if (cached !== undefined) return cached;
    if (modulePath.length === 0) {
      throw new Error(`game '${gameId}' has no module path`);
    }
    const imported: unknown = await import(modulePath);
    const definition = pickExport(imported, exportName);
    if (!isGame(definition)) {
      throw new Error(
        `module '${modulePath}' did not export a game definition`
      );
    }
    this.games.set(key, definition);
    return definition;
  }
}

function readGameId(config: { readonly [key: string]: unknown }): string {
  const gameId = config['gameId'];
  return typeof gameId === 'string' ? gameId : '';
}

function pickExport(
  imported: unknown,
  exportName: string | undefined
): unknown {
  if (typeof imported !== 'object' || imported === null) return undefined;
  const record = imported as { readonly [key: string]: unknown };
  if (exportName !== undefined && exportName.length > 0) {
    return record[exportName];
  }
  return record['default'] ?? record['RelayGame'];
}

function isGame(value: unknown): value is AnyGameDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { id?: unknown; commands?: unknown };
  if (typeof record.id !== 'string') return false;
  if (typeof record.commands !== 'object' || record.commands === null) {
    return false;
  }
  return typeof (record.commands as { decode?: unknown }).decode === 'function';
}

function toOutcome(outcome: MatchOutcome): SimOutcome {
  if (outcome.kind === 'win') {
    return {
      kind: 'win',
      winnerTeam: outcome.winnerTeam,
      reason: outcome.reason,
    };
  }
  return { kind: 'draw', reason: outcome.reason };
}
