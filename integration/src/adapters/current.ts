import {
  LocalTransport,
  MatchRunner,
  SnapshotRejectedError,
  botPlayerId,
  decodeSnapshot,
  encodeSnapshot,
  isBotPlayerId,
  type LogEntry as EngineLogEntry,
  type ReplayRecord,
} from '@phalanx-engine/runtime';
import { CURRENT_CAPABILITIES } from '../driver/capabilities.js';
import type {
  GameCommandJson,
  LogEntry,
  MatchHandle,
  MatchSpec,
  Peer,
  PeerOptions,
  ReplayFile,
  SimDriver,
  StateDump,
} from '../driver/SimDriver.js';
import {
  createSkirmishGame,
  type SkirmishConfig,
  type SkirmishSession,
} from '../facade/current.js';
import type { SkirmishCommand as Command } from '../game/skirmish/types.js';
import { canonicalDigest } from '../oracle/digest.js';
import { errorMessage, isJson, type Json } from '../util/json.js';

interface Live {
  readonly runner: MatchRunner<ReturnType<typeof createSkirmishGame>>;
  readonly transport: LocalTransport;
  readonly role: PeerOptions['role'];
  readonly delivered: Set<string>;
  started: boolean;
  outcomeText: string | null;
}

/**
 * SimDriver on the runtime adapter: `defineGame`, `MatchRunner`, and
 * `LocalTransport`. The `@phalanx-engine/engine` facade is not used here.
 */
export function createCurrentDriver(): SimDriver {
  return {
    name: 'current',
    capabilities: CURRENT_CAPABILITIES,
    createMatch(spec: MatchSpec): MatchHandle {
      return openMatch(spec);
    },
    openReplay(replay: ReplayFile): Peer {
      return openReplayPeer(replay);
    },
    incompatibleSnapshot(bytes: Uint8Array): Uint8Array {
      return mutateSnapshot(bytes, 'version');
    },
    swapSchemaFields(bytes: Uint8Array): Uint8Array {
      return mutateSnapshot(bytes, 'swap');
    },
    changeSchemaFieldType(bytes: Uint8Array): Uint8Array {
      return mutateSnapshot(bytes, 'type');
    },
  };
}

export { SnapshotRejectedError };

function openMatch(spec: MatchSpec): MatchHandle {
  const session: SkirmishSession = {
    currentPeer: '',
    inject: spec.options.injectDesync,
    spawnOnRestore: spec.options.spawnOnRestore === true,
    throwOnTick: spec.options.throwOnTick,
    suppressThrow: spec.options.suppressThrow === true,
    throwBot: spec.options.throwBot === true,
    poolProbe: spec.options.poolProbe === true,
    dirtyAfterRestore: spec.options.dirtyAfterRestore === true,
    breakBotRestore: spec.options.breakBotRestore === true,
    injectTick: -1,
    bots: {},
  };
  const game = createSkirmishGame(session, poolsFor(spec));
  const config = toConfig(spec);
  const peers: Peer[] = [];
  let authorityRunner: Live['runner'] | null = null;
  const cache: { entries: readonly LogEntry[] } = { entries: [] };

  const handle: MatchHandle = {
    createPeer(id, opts): Peer {
      session.currentPeer = id;
      const transport = LocalTransport.stepped();
      const runner = new MatchRunner(game, config, transport, {
        localSlots:
          opts.role === 'authority'
            ? config.slots
                .filter((slot) => slot.kind === 'human')
                .map((slot) => slot.slot)
            : [],
      });
      const live: Live = {
        runner,
        transport,
        role: opts.role,
        delivered: new Set(),
        started: false,
        outcomeText: null,
      };
      runner.onOutcome((outcome) => {
        live.outcomeText =
          outcome.kind === 'win'
            ? `win:${String(outcome.winnerTeam)}`
            : `draw:${outcome.reason}`;
      });
      const peer = wrapPeer(id, live, session);
      peers.push(peer);
      if (opts.role === 'authority') authorityRunner = live.runner;
      return peer;
    },
    log(): readonly LogEntry[] {
      const runner = authorityRunner;
      if (runner === null || runner.status === 'disposed') return cache.entries;
      cache.entries = mapLog(runner.log.entriesAfter(-1));
      return cache.entries;
    },
    armInject(tick: number): void {
      if (session.inject === undefined || session.inject.when === 'restore') {
        return;
      }
      session.injectTick = tick;
    },
    dispose(): void {
      for (const peer of peers) peer.dispose();
    },
  };
  return handle;
}

function wrapPeer(id: string, live: Live, session: SkirmishSession): Peer {
  let failure: unknown = null;
  live.runner.onError((error) => {
    failure = error;
  });
  return {
    id,
    submit(cmd, slot) {
      live.runner.submit(asCommand(cmd), slot);
    },
    step(ticks: number): void {
      // Perf times this method. Log capture stays on match.log().
      session.currentPeer = id;
      if (live.role === 'replay') {
        throw new Error(
          'MatchRunner.openReplay: drive the runner with fastForward(replay.log, { throughTick: replay.lastTick })'
        );
      }
      if (!live.started) {
        live.runner.start();
        live.started = true;
      }
      failure = null;
      live.transport.step(ticks);
      if (failure !== null) {
        const error = failure;
        failure = null;
        throw error instanceof Error ? error : new Error(errorMessage(error));
      }
    },
    tick: () => live.runner.tick,
    snapshot: () => live.runner.snapshot(),
    restore(bytes: Uint8Array): void {
      session.currentPeer = id;
      live.runner.restore(bytes);
      session.poke?.();
    },
    async fastForward(entries, throughTick): Promise<void> {
      session.currentPeer = id;
      await live.runner.fastForward(entries as readonly EngineLogEntry[], {
        budgetMs: 250,
        throughTick,
      });
    },
    deliver(entry): void {
      if (isBotPlayerId(entry.playerId)) return;
      const slot = slotOf(entry.playerId);
      if (slot === null) return;
      const key = `${String(entry.tick)}:${entry.playerId}:${String(entry.data.q)}`;
      if (live.delivered.has(key)) return;
      if (!live.started) {
        live.runner.start();
        live.started = true;
      }
      live.transport.submit(entry.tick, slot, [
        { type: entry.type, data: entry.data },
      ]);
      live.delivered.add(key);
    },
    digest: () => canonicalDigest(thisState(live)),
    stateDump: (): StateDump => thisState(live),
    status: () => live.runner.status,
    outcome: () => live.outcomeText,
    pause(): void {
      live.transport.requestPause();
    },
    resume(): void {
      live.transport.requestResume();
    },
    injectMalformed(slot: number): void {
      const target = live.runner.tick + 1;
      live.transport.submit(target, slot, [
        { type: 'move', data: { q: -1, p: null } },
      ]);
    },
    toReplay(): ReplayFile {
      return toReplayFile(live.runner.toReplay());
    },
    dispose(): void {
      live.runner.dispose();
    },
  };
}

function openReplayPeer(replay: ReplayFile): Peer {
  const session: SkirmishSession = {
    currentPeer: 'replay',
    spawnOnRestore: false,
    suppressThrow: false,
    throwBot: false,
    poolProbe: false,
    dirtyAfterRestore: false,
    breakBotRestore: false,
    injectTick: -1,
    bots: {},
  };
  const game = createSkirmishGame(session, poolsFromReplay(replay.config));
  const record = replay as unknown as ReplayRecord<SkirmishConfig>;
  // ReplayFile is the JSON form of ReplayRecord. The runner checks
  // format, game id, sim version, and tick bounds itself.
  const runner = MatchRunner.openReplay(game, record);
  const transport = LocalTransport.stepped();
  const live: Live = {
    runner,
    transport,
    role: 'replay',
    delivered: new Set(),
    started: false,
    outcomeText: null,
  };
  runner.onOutcome((outcome) => {
    live.outcomeText =
      outcome.kind === 'win'
        ? `win:${String(outcome.winnerTeam)}`
        : `draw:${outcome.reason}`;
  });
  return wrapPeer('replay', live, session);
}

function mapLog(entries: readonly EngineLogEntry[]): LogEntry[] {
  return entries.map((entry) => ({
    tick: entry.tick,
    playerId: entry.playerId,
    type: entry.type,
    data: { q: entry.data.q, p: entry.data.p },
    ...(entry.malformed === true ? { malformed: true as const } : {}),
  }));
}

function thisState(live: Live): StateDump {
  return live.runner.sim.stateDump();
}

function slotOf(playerId: string): number | null {
  if (!playerId.startsWith('local:')) return null;
  const slot = Number(playerId.slice('local:'.length));
  if (!Number.isInteger(slot) || slot < 0) return null;
  return slot;
}

function mutateSnapshot(
  bytes: Uint8Array,
  mode: 'version' | 'swap' | 'type'
): Uint8Array {
  const decoded = decodeSnapshot(bytes);
  const schemas =
    mode === 'version'
      ? decoded.componentSchemas
      : rewriteSchema(decoded.componentSchemas, mode);
  return encodeSnapshot(
    {
      engineFormat: decoded.header.engineFormat,
      gameId: decoded.header.gameId,
      simVersion: decoded.header.simVersion,
      formatVersion:
        mode === 'version'
          ? decoded.header.formatVersion + 1
          : decoded.header.formatVersion,
      configHash: decoded.header.configHash,
      tick: decoded.header.tick,
    },
    decoded.body,
    {
      botState: decoded.botState,
      inputCheckpoint: decoded.inputCheckpoint,
      componentSchemas: schemas,
    }
  );
}

function rewriteSchema(
  key: string | null,
  mode: 'swap' | 'type'
): string | null {
  if (key === null) return null;
  const parsed: unknown = JSON.parse(key);
  if (!Array.isArray(parsed)) return key;
  const components: { name: string; fields: string[][] }[] = [];
  for (const item of parsed) {
    if (!isSchemaComponent(item)) return key;
    const fields: string[][] = [];
    for (const field of item.fields) {
      const name = field[0];
      const typeName = field[1];
      if (name === undefined || typeName === undefined) continue;
      fields.push([name, typeName]);
    }
    if (item.name === 'SkirmishUnit' && mode === 'swap' && fields.length >= 2) {
      const first = fields[0];
      const second = fields[1];
      if (first !== undefined && second !== undefined) {
        fields[0] = second;
        fields[1] = first;
      }
    }
    if (item.name === 'SkirmishUnit' && mode === 'type') {
      for (const field of fields) {
        if (field[0] === 'homeZ') field[1] = 'u32';
      }
    }
    components.push({ name: item.name, fields });
  }
  return JSON.stringify(components);
}

function isSchemaComponent(
  value: unknown
): value is { name: string; fields: string[][] } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as { name?: unknown; fields?: unknown };
  if (typeof record.name !== 'string' || !Array.isArray(record.fields)) {
    return false;
  }
  return record.fields.every(
    (field) =>
      Array.isArray(field) &&
      field.length === 2 &&
      typeof field[0] === 'string' &&
      typeof field[1] === 'string'
  );
}

function isJsonRecord(value: Json): value is { readonly [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function poolsFor(spec: MatchSpec): {
  readonly armySize: number;
  readonly slotCount: number;
} {
  return {
    armySize: spec.options.armySize ?? 0,
    slotCount: spec.slots.length,
  };
}

function poolsFromReplay(config: Json): {
  readonly armySize: number;
  readonly slotCount: number;
} {
  if (!isJsonRecord(config)) return { armySize: 0, slotCount: 2 };
  const army = config['armySize'];
  const slots = config['slots'];
  return {
    armySize: typeof army === 'number' && Number.isInteger(army) ? army : 0,
    slotCount: Array.isArray(slots) ? slots.length : 2,
  };
}

function toConfig(spec: MatchSpec): SkirmishConfig {
  return {
    matchId: 'skirmish',
    gameId: 'skirmish',
    simVersion: 'skirmish-1',
    seed: spec.seed >>> 0,
    side: 'client',
    inputDelayTicks: spec.inputDelayTicks,
    tickLimit: spec.options.tickLimit ?? 1_000_000,
    armySize: spec.options.armySize ?? 0,
    slots: spec.slots.map((slot, index) =>
      slot.kind === 'bot'
        ? {
            slot: index,
            team: slot.team,
            kind: 'bot' as const,
            policy: slot.policy ?? 'aggressive',
            level: slot.level ?? 1,
            runsOn: 'local' as const,
          }
        : {
            slot: index,
            team: slot.team,
            kind: 'human' as const,
            playerId: `local:${String(index)}`,
          }
    ),
  };
}

function asCommand(cmd: GameCommandJson): Command {
  if (
    cmd.type !== 'move' &&
    cmd.type !== 'attack' &&
    cmd.type !== 'cast' &&
    cmd.type !== 'spawn' &&
    cmd.type !== 'recall'
  ) {
    throw new Error(`skirmish: unknown command ${cmd.type}`);
  }
  // The type string was checked above. Optional JSON fields match the command union.
  return cmd as Command;
}

function toReplayFile(record: ReplayRecord<SkirmishConfig>): ReplayFile {
  const config = record.config as unknown as Json;
  if (!isJson(config)) throw new Error('skirmish: replay config is not JSON');
  const file: ReplayFile = {
    format: record.format,
    gameId: record.gameId,
    simVersion: record.simVersion,
    config,
    log: record.log.map((entry) => ({
      tick: entry.tick,
      playerId: entry.playerId,
      type: entry.type,
      data: { q: entry.data.q, p: entry.data.p },
      ...(entry.malformed === true ? { malformed: true as const } : {}),
    })),
    lastTick: record.lastTick,
  };
  if (record.finalDigest !== undefined) {
    return { ...file, finalDigest: record.finalDigest };
  }
  return file;
}

export function playerIdFor(slot: number, kind: 'human' | 'bot'): string {
  return kind === 'bot' ? botPlayerId(slot) : `local:${String(slot)}`;
}
