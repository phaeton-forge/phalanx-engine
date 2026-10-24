import {
  MatchSessionStore,
  type GameStartEvent,
  type MatchLogEntry,
  type MatchSession,
  type PhalanxClient,
} from '@phalanx-engine/client';
import { botPlayerId } from '@phalanx-engine/protocol';
import type { TransportCommand } from '../game/commands.js';
import type { LogEntry } from '../runner/CommandLog.js';
import { entriesFromBatch } from '../runner/MatchRunner.js';
import type { Digest } from '../state/snapshot.js';
import type {
  CommandsBatch,
  FrameHandler,
  PauseHandler,
  TickHandler,
  Unsubscribe,
} from '../transport/providerTypes.js';
import type {
  Transport,
  TransportCatchUp,
  TransportJoin,
} from '../transport/Transport.js';

export interface ServerPeerTransportOptions {
  readonly client: PhalanxClient;
  /** Key of the stored session (`phalanx.session.<gameId>`). */
  readonly gameId: string;
  /** Defaults to `new MatchSessionStore(gameId)`. */
  readonly sessionStore?: MatchSessionStore;
}

type JsonConfig = { readonly [key: string]: unknown };

/**
 * Client side of a server-simulation match (`simMode: 'server'`). Ticks,
 * frames and pause come from `PhalanxClient`. `join()` starts a fresh
 * match from `game-start`, or resumes the stored session with
 * `resumeMatch`, the latest server snapshot and the log after it.
 * Batches that arrive while a catch-up runs are held and delivered in
 * tick order, each once, after it.
 */
export class ServerPeerTransport implements Transport {
  public readonly kind = 'server-peer' as const;
  private readonly client: PhalanxClient;
  private readonly store: MatchSessionStore;
  private readonly tickHandlers = new Set<TickHandler>();
  private readonly unsubs: Unsubscribe[] = [];
  private readonly startWaiters: ((event: GameStartEvent) => void)[] = [];
  private readonly held: { tick: number; batch: CommandsBatch }[] = [];
  private gameStart: GameStartEvent | null = null;
  private matchConfig: JsonConfig | null = null;
  private holding = false;
  private releaseReady = false;
  private nextTick = 0;
  private disposed = false;

  public constructor(options: ServerPeerTransportOptions) {
    this.client = options.client;
    this.store =
      options.sessionStore ?? new MatchSessionStore(options.gameId);
    this.unsubs.push(
      this.client.onTick((tick, batch) => {
        this.onClientTick(tick, batch);
      }),
      this.client.on('gameStart', (event) => {
        this.onGameStart(event);
      }),
      this.client.on('sessionToken', (event) => {
        this.onSessionToken(event.token);
      }),
      this.client.on('matchEnd', () => {
        this.store.clear();
      })
    );
  }

  public onTick(handler: TickHandler): Unsubscribe {
    this.tickHandlers.add(handler);
    return () => {
      this.tickHandlers.delete(handler);
    };
  }

  public onFrame(handler: FrameHandler): Unsubscribe {
    return this.track(this.client.onFrame(handler));
  }

  public onPause(handler: PauseHandler): Unsubscribe {
    return this.track(this.client.onPause(handler));
  }

  public onResume(handler: PauseHandler): Unsubscribe {
    return this.track(this.client.onResume(handler));
  }

  public requestPause(): void {
    this.client.requestPause();
  }

  public requestResume(): void {
    this.client.requestResume();
  }

  public async join(): Promise<TransportJoin> {
    const session = this.store.load();
    if (
      this.gameStart === null &&
      session !== null &&
      session.matchConfig !== undefined
    ) {
      return this.resume(session, session.matchConfig);
    }
    return this.fresh();
  }

  public submit(
    targetTick: number,
    _slot: number,
    commands: readonly TransportCommand[]
  ): void {
    this.client.submitCommandsAsync(
      targetTick,
      commands.map((command) => ({ type: command.type, data: command.data }))
    );
  }

  public submitHash(tick: number, digest: Digest): void {
    this.client.submitStateHash(tick, digest);
  }

  public onDesync(handler: (tick: number) => void): Unsubscribe {
    return this.track(
      this.client.on('serverDesync', (event) => {
        if (event.playerId === this.client.getPlayerId()) handler(event.tick);
      })
    );
  }

  public async requestResync(): Promise<TransportCatchUp> {
    const matchConfig = this.matchConfig;
    if (matchConfig === null) {
      throw new Error('ServerPeerTransport.requestResync: call join() first');
    }
    this.hold();
    try {
      return await this.catchUp(matchConfig, true, 0);
    } finally {
      this.releaseReady = true;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsub of this.unsubs.splice(0)) unsub();
    this.tickHandlers.clear();
    this.held.length = 0;
    this.startWaiters.length = 0;
  }

  private async fresh(): Promise<TransportJoin> {
    const start =
      this.gameStart ??
      (await new Promise<GameStartEvent>((resolve) => {
        this.startWaiters.push(resolve);
      }));
    const matchConfig = start.matchConfig;
    if (!isPlainObject(matchConfig)) {
      throw new Error(
        'ServerPeerTransport.join: game-start has no matchConfig (not a server-simulation match)'
      );
    }
    this.matchConfig = matchConfig;
    const playerId = this.client.getPlayerId();
    const localSlots = humanSlots(matchConfig)
      .filter((slot) => slot.playerId === playerId)
      .map((slot) => slot.slot);
    this.client.sendReady();
    return { config: clientConfig(matchConfig), localSlots };
  }

  private async resume(
    session: MatchSession,
    matchConfig: JsonConfig
  ): Promise<TransportJoin> {
    this.matchConfig = matchConfig;
    this.hold();
    try {
      if (!this.client.isConnected()) await this.client.connect();
      const state = await this.client.resumeMatch(session.token, -1);
      const catchUp = await this.catchUp(
        matchConfig,
        state.snapshot !== undefined,
        state.currentTick
      );
      return {
        config: clientConfig(matchConfig),
        localSlots: [state.slot],
        catchUp,
      };
    } finally {
      this.releaseReady = true;
    }
  }

  private async catchUp(
    matchConfig: JsonConfig,
    withSnapshot: boolean,
    serverTick: number
  ): Promise<TransportCatchUp> {
    const snapshot = withSnapshot
      ? await this.client.requestMatchSnapshot()
      : undefined;
    const fromTick = snapshot === undefined ? 0 : snapshot.tick + 1;
    const slotByPlayerId = slotsByPlayerId(matchConfig);
    const log: LogEntry[] = [];
    let lastLogTick = -1;
    for await (const chunk of this.client.fetchMatchLog(fromTick)) {
      for (const entry of chunk.entries) {
        if (entry.tick < fromTick) continue;
        log.push(...logEntriesOf(entry, slotByPlayerId));
        lastLogTick = Math.max(lastLogTick, entry.tick);
      }
      if (chunk.done) break;
    }
    const currentTick = Math.max(
      serverTick,
      fromTick,
      lastLogTick + 1,
      this.nextTick
    );
    this.nextTick = currentTick;
    return snapshot === undefined
      ? { log, currentTick }
      : { snapshot: snapshot.bytes, log, currentTick };
  }

  private hold(): void {
    this.holding = true;
    this.releaseReady = false;
  }

  /**
   * Held batches are released on the next live batch, after the runner
   * that awaited the catch-up has started.
   */
  private onClientTick(tick: number, batch: CommandsBatch): void {
    if (this.disposed) return;
    if (this.holding && !this.releaseReady) {
      this.held.push({ tick, batch });
      return;
    }
    this.holding = false;
    const queued = this.held.splice(0);
    queued.push({ tick, batch });
    queued.sort((a, b) => a.tick - b.tick);
    for (const item of queued) this.deliver(item.tick, item.batch);
  }

  private deliver(tick: number, batch: CommandsBatch): void {
    if (tick < this.nextTick) return;
    this.nextTick = tick + 1;
    for (const handler of [...this.tickHandlers]) handler(tick, batch);
  }

  private onGameStart(event: GameStartEvent): void {
    this.gameStart = event;
    const matchConfig = event.matchConfig;
    if (isPlainObject(matchConfig)) {
      const existing = this.store.load();
      if (existing !== null && existing.matchId === event.matchId) {
        this.store.save({
          ...existing,
          slot: this.ownSlot(matchConfig) ?? existing.slot,
          matchConfig,
        });
      }
    }
    for (const resolve of this.startWaiters.splice(0)) resolve(event);
  }

  private onSessionToken(token: string): void {
    const existing = this.store.load();
    const matchId = this.client.getMatchId() ?? existing?.matchId;
    if (matchId === undefined) return;
    const same = existing !== null && existing.matchId === matchId;
    const startConfig =
      this.gameStart?.matchId === matchId &&
      isPlainObject(this.gameStart.matchConfig)
        ? this.gameStart.matchConfig
        : undefined;
    const matchConfig = same ? existing.matchConfig : startConfig;
    this.store.save({
      token,
      matchId,
      slot:
        (startConfig === undefined ? undefined : this.ownSlot(startConfig)) ??
        (same ? existing.slot : 0),
      buildId: same ? existing.buildId : '',
      ...(matchConfig === undefined ? {} : { matchConfig }),
    });
  }

  private ownSlot(matchConfig: JsonConfig): number | undefined {
    const playerId = this.client.getPlayerId();
    return humanSlots(matchConfig).find((slot) => slot.playerId === playerId)
      ?.slot;
  }

  private track(unsub: Unsubscribe): Unsubscribe {
    this.unsubs.push(unsub);
    return unsub;
  }
}

interface ConfigSlot {
  readonly slot: number;
  readonly kind: 'human' | 'bot';
  readonly playerId?: string;
}

function isPlainObject(value: unknown): value is JsonConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configSlots(matchConfig: JsonConfig): ConfigSlot[] {
  const slots = matchConfig['slots'];
  if (!Array.isArray(slots)) return [];
  const result: ConfigSlot[] = [];
  for (const item of slots as unknown[]) {
    if (!isPlainObject(item)) continue;
    const slot = item['slot'];
    const kind = item['kind'];
    const playerId = item['playerId'];
    if (typeof slot !== 'number' || (kind !== 'human' && kind !== 'bot')) {
      continue;
    }
    result.push(
      typeof playerId === 'string' ? { slot, kind, playerId } : { slot, kind }
    );
  }
  return result;
}

function humanSlots(matchConfig: JsonConfig): ConfigSlot[] {
  return configSlots(matchConfig).filter((slot) => slot.kind === 'human');
}

function slotsByPlayerId(matchConfig: JsonConfig): Map<string, number> {
  const map = new Map<string, number>();
  for (const slot of configSlots(matchConfig)) {
    const playerId =
      slot.kind === 'human' ? slot.playerId : botPlayerId(slot.slot);
    if (playerId !== undefined) map.set(playerId, slot.slot);
  }
  return map;
}

/** The server builds the config with `side: 'server'`; this peer is a client. */
function clientConfig(matchConfig: JsonConfig): JsonConfig {
  return { ...matchConfig, side: 'client' };
}

/** Same parsing and (slot, seq) order as a live batch. */
function logEntriesOf(
  entry: MatchLogEntry,
  slotByPlayerId: ReadonlyMap<string, number>
): LogEntry[] {
  const batch: CommandsBatch = { tick: entry.tick, commands: {} };
  for (const command of entry.commands) {
    const list = (batch.commands[command.playerId] ??= []);
    list.push(command);
  }
  return entriesFromBatch(entry.tick, batch, slotByPlayerId, true).entries;
}
