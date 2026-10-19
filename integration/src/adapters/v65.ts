import {
  LocalTransport,
  MatchRunner,
  ReplayPlayer,
  SYSTEM_PLAYER_ID,
  botPlayerId,
  decodeSnapshot,
  encodeSnapshot,
  type JsonValue,
  type LogEntry as EngineLogEntry,
  type ReplayRecord,
} from '@phalanx-engine/game';
import { V65_CAPABILITIES } from '../driver/capabilities.js';
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
} from '../facade/v65.js';
import type { SkirmishCommand as Command } from '../game/skirmish/types.js';
import { canonicalDigest } from '../oracle/digest.js';
import { errorMessage, isJson, type Json } from '../util/json.js';

interface Rejection {
  readonly type: string;
  readonly reason: string;
}

interface Live {
  readonly runner: MatchRunner<ReturnType<typeof createSkirmishGame>>;
  readonly transport: LocalTransport;
  readonly role: PeerOptions['role'];
  readonly delivered: Set<string>;
  readonly rejections: Rejection[];
  started: boolean;
  outcomeText: string | null;
}

/**
 * `runLocalMatch` starts one clocked runner. This suite builds several
 * peers, steps them by hand, and pushes envelopes through `FaultyTransport`,
 * so each peer is a `MatchRunner` on `LocalTransport.stepped()`.
 * Replay peers use `ReplayPlayer`, which never calls bot `decide`.
 */
export function createV65Driver(): SimDriver {
  return {
    name: 'v65',
    capabilities: V65_CAPABILITIES,
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

function openMatch(spec: MatchSpec): MatchHandle {
  const session = emptySession(spec);
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
        rejections: [],
        started: false,
        outcomeText: null,
      };
      runner.onOutcome((outcome) => {
        live.outcomeText =
          outcome.kind === 'win'
            ? `win:${String(outcome.winnerTeam)}`
            : `draw:${outcome.reason}`;
      });
      runner.onRejected((entry, reason) => {
        live.rejections.push({ type: entry.type, reason });
      });
      const peer = wrapPeer(id, live, session, spec);
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

function wrapPeer(
  id: string,
  live: Live,
  session: SkirmishSession,
  spec: MatchSpec
): Peer {
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
      session.currentPeer = id;
      if (live.role === 'replay') {
        throw new Error(
          'ReplayPlayer: drive the player with play() or fastForward(throughTick)'
        );
      }
      if (!live.started) {
        live.runner.start();
        live.started = true;
      }
      failure = null;
      live.transport.step(ticks);
      reconcileControls(live, session);
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
      reconcileControls(live, session);
      session.poke?.();
    },
    async fastForward(entries, throughTick): Promise<void> {
      session.currentPeer = id;
      await live.runner.fastForward(entries as readonly EngineLogEntry[], {
        budgetMs: 250,
        throughTick,
      });
      reconcileControls(live, session);
    },
    deliver(entry): void {
      if (entry.playerId === SYSTEM_PLAYER_ID) return;
      const slot = slotOf(entry.playerId);
      if (slot === null) return;
      const key = deliveryKey(entry);
      if (live.delivered.has(key)) return;
      if (!live.started) {
        live.runner.start();
        live.started = true;
      }
      // A bot handoff rebinds the slot's transport id. Keep the logged
      // human id so the runner rejects the command instead of applying
      // it as a bot command.
      live.transport.assignPlayerId(slot, entry.playerId);
      live.transport.submit(entry.tick, slot, [
        { type: entry.type, data: entry.data },
      ]);
      live.delivered.add(key);
    },
    digest: () => canonicalDigest(dumpOf(session, id)),
    stateDump: (): StateDump => dumpOf(session, id),
    status: () => live.runner.status,
    outcome: () => live.outcomeText,
    pause(): void {
      live.transport.requestPause();
    },
    resume(): void {
      live.transport.requestResume();
    },
    injectMalformed(slot: number, targetTick?: number): void {
      const target = targetTick ?? live.runner.tick + 1;
      // Extra envelope. `submit` appends to the slot queue, so the real
      // command for this tick stays in the batch.
      live.transport.submit(target, slot, [
        { type: 'move', data: { q: -1, p: null } },
      ]);
    },
    toReplay(): ReplayFile {
      return toReplayFile(live.runner.toReplay());
    },
    setController(slot, mode, opts) {
      const before = live.rejections.length;
      live.runner.setController(slot, mode, opts);
      const rejected = live.rejections.slice(before).find((item) => {
        return item.type === 'setController';
      });
      if (rejected !== undefined) return rejected.reason;
      const fromTick =
        opts?.fromTick ?? live.runner.tick + spec.inputDelayTicks;
      noteControl(session, slot, mode, fromTick);
      return null;
    },
    controllerOf(slot) {
      return controllerOf(session, spec, slot, live.runner.tick);
    },
    rejections: () => live.rejections.slice(),
    commandLog: () => mapLog(live.runner.log.entriesAfter(-1)),
    dispose(): void {
      live.runner.dispose();
    },
  };
}

function openReplayPeer(replay: ReplayFile): Peer {
  const session = emptySession({
    seed: 0,
    inputDelayTicks: 1,
    slots: [],
    options: {},
  });
  session.currentPeer = 'replay';
  const game = createSkirmishGame(session, poolsFromReplay(replay.config));
  // ReplayFile is the JSON form of ReplayRecord. The player checks format,
  // game id, sim version, and tick bounds itself. The suite stores config
  // as JSON, which is the shape ReplayRecord already persisted.
  const record = replay as unknown as ReplayRecord<SkirmishConfig>;
  const player = ReplayPlayer.from(game, record);
  return {
    id: 'replay',
    submit() {
      throw new Error(
        'ReplayPlayer: drive the player with play() or fastForward(throughTick)'
      );
    },
    step() {
      throw new Error(
        'ReplayPlayer: drive the player with play() or fastForward(throughTick)'
      );
    },
    tick: () => player.tick,
    snapshot: () => {
      throw new Error('ReplayPlayer: a replay peer has no snapshot');
    },
    restore() {
      throw new Error('ReplayPlayer: a replay peer cannot restore');
    },
    async fastForward(_entries, throughTick): Promise<void> {
      await player.fastForward(throughTick);
    },
    deliver() {},
    digest: () => canonicalDigest(dumpOf(session, 'replay')),
    stateDump: () => dumpOf(session, 'replay'),
    status: () => (player.tick < 0 ? 'ready' : 'running'),
    outcome: () => null,
    pause() {},
    resume() {},
    injectMalformed() {},
    toReplay: () => replay,
    setController() {
      return 'replay cannot change controller';
    },
    controllerOf(slot) {
      return controllerOf(session, replaySpec(replay), slot, player.tick);
    },
    rejections: () => [],
    commandLog: () => replay.log,
    dispose(): void {
      session.bound['replay']?.world.dispose();
    },
  };
}

function deliveryKey(entry: LogEntry): string {
  // The runner rewrites a malformed envelope to q 0, which is also the
  // first real command's seq. The payload keeps them distinct so deliver
  // does not drop the move.
  return `${String(entry.tick)}:${entry.playerId}:${String(entry.data.q)}:${entry.type}:${entry.malformed === true ? '1' : '0'}:${JSON.stringify(entry.data.p)}`;
}

function reconcileControls(live: Live, session: SkirmishSession): void {
  const tick = live.runner.tick;
  const latest: Record<string, 'human' | 'bot'> = {};
  for (const entry of live.runner.log.entriesAfter(-1)) {
    if (entry.tick > tick) continue;
    const change = systemChange(entry);
    if (change === null) continue;
    noteControl(session, change.slot, change.mode, entry.tick);
    latest[String(change.slot)] = change.mode;
  }
  const row = session.bots[session.currentPeer];
  if (row === undefined) return;
  for (const slot of Object.keys(latest).sort()) {
    if (latest[slot] === 'human') delete row[slot];
  }
}

function systemChange(
  entry: EngineLogEntry
): { readonly slot: number; readonly mode: 'human' | 'bot' } | null {
  if (entry.playerId !== SYSTEM_PLAYER_ID || entry.type !== 'setController') {
    return null;
  }
  const payload = entry.data.p;
  if (!isControllerPayload(payload)) return null;
  const slot = payload['slot'];
  const mode = payload['mode'];
  if (typeof slot !== 'number' || !Number.isInteger(slot)) return null;
  if (mode !== 'human' && mode !== 'bot') return null;
  return { slot, mode };
}

function noteControl(
  session: SkirmishSession,
  slot: number,
  mode: 'human' | 'bot',
  fromTick: number
): void {
  for (const change of session.controls) {
    if (
      change.slot === slot &&
      change.mode === mode &&
      change.fromTick === fromTick
    ) {
      return;
    }
  }
  session.controls.push({ slot, mode, fromTick });
}

function controllerOf(
  session: SkirmishSession,
  spec: MatchSpec,
  slot: number,
  tick: number
): 'human' | 'bot' {
  const initial = spec.slots[slot];
  let mode: 'human' | 'bot' = initial?.kind === 'bot' ? 'bot' : 'human';
  for (const change of session.controls) {
    if (change.slot !== slot || change.fromTick > tick) continue;
    mode = change.mode;
  }
  return mode;
}

function dumpOf(session: SkirmishSession, id: string): StateDump {
  const sim = session.bound[id];
  if (sim === undefined) throw new Error(`skirmish: no sim for ${id}`);
  return sim.stateDump();
}

function emptySession(spec: MatchSpec): SkirmishSession {
  return {
    currentPeer: '',
    inject: spec.options.injectDesync,
    spawnOnRestore: spec.options.spawnOnRestore === true,
    throwOnTick: spec.options.throwOnTick,
    suppressThrow: spec.options.suppressThrow === true,
    throwBot: spec.options.throwBot === true,
    poolProbe: spec.options.poolProbe === true,
    dirtyAfterRestore: spec.options.dirtyAfterRestore === true,
    breakBotRestore: spec.options.breakBotRestore === true,
    corruptOnRestore: spec.options.corruptOnRestore === true,
    injectTick: -1,
    bots: {},
    bound: {},
    controls: [],
  };
}

function replaySpec(_replay: ReplayFile): MatchSpec {
  return {
    seed: 0,
    inputDelayTicks: 1,
    slots: [],
    options: {},
  };
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

function slotOf(playerId: string): number | null {
  const body = playerId.startsWith('local:')
    ? playerId.slice('local:'.length)
    : playerId.startsWith('bot:')
      ? playerId.slice('bot:'.length)
      : null;
  if (body === null) return null;
  const slot = Number(body);
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

function isControllerPayload(
  value: JsonValue
): value is { readonly [key: string]: JsonValue } {
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
  // The type string was checked above. Payload fields are the command's.
  return cmd as Command;
}

function toReplayFile(record: ReplayRecord<SkirmishConfig>): ReplayFile {
  // Match config is a JSON object the runner already hashed. `isJson`
  // rejects a value that is not JSON before it is stored on ReplayFile.
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
