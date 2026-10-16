import {
  LocalTransport,
  MatchRunner,
  SnapshotRejectedError,
  botPlayerId,
  decodeSnapshot,
  encodeSnapshot,
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
import { errorMessage, isJson, type Json } from '../util/json.js';

interface Live {
  readonly runner: MatchRunner<ReturnType<typeof createSkirmishGame>>;
  readonly transport: LocalTransport;
  readonly role: PeerOptions['role'];
  started: boolean;
  outcomeText: string | null;
}

/**
 * SimDriver on today's main API: `defineGame`, `MatchRunner`,
 * `LocalTransport`, and `world.save` / `world.restore` (Task 6.5a).
 * `spawnWithId` is reached only when `legacySpawnWithId` is set.
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
      const decoded = decodeSnapshot(bytes);
      return encodeSnapshot(
        {
          engineFormat: decoded.header.engineFormat,
          gameId: decoded.header.gameId,
          simVersion: decoded.header.simVersion,
          formatVersion: decoded.header.formatVersion + 1,
          configHash: decoded.header.configHash,
          tick: decoded.header.tick,
        },
        decoded.body,
        {
          botState: decoded.botState,
          inputCheckpoint: decoded.inputCheckpoint,
          componentSchemas: decoded.componentSchemas,
        }
      );
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
    throwBot: spec.options.throwBot === true,
    poolProbe: spec.options.poolProbe === true,
    legacySpawnWithId: spec.options.legacySpawnWithId === true,
  };
  const game = createSkirmishGame(session);
  const config = toConfig(spec);
  const peers: Peer[] = [];
  let authority: Peer | null = null;
  const cache: { entries: readonly LogEntry[] } = { entries: [] };

  const remember = (peer: Peer | null): readonly LogEntry[] => {
    if (peer === null || peer.status() === 'disposed') return cache.entries;
    try {
      cache.entries = peer.toReplay().log;
    } catch {
      // Restore truncates history. Keep the last complete copy.
    }
    return cache.entries;
  };

  const handle: MatchHandle = {
    createPeer(id, opts): Peer {
      session.currentPeer = id;
      const transport = LocalTransport.manual();
      const runner = new MatchRunner(game, config, transport, {
        side: 'client',
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
        started: false,
        outcomeText: null,
      };
      runner.onOutcome((outcome) => {
        live.outcomeText =
          outcome.kind === 'win'
            ? `win:${String(outcome.winnerTeam)}`
            : `draw:${outcome.reason}`;
      });
      const peer = wrapPeer(id, live, session, () => {
        remember(peer);
      });
      peers.push(peer);
      if (opts.role === 'authority') authority = peer;
      return peer;
    },
    log(): readonly LogEntry[] {
      return remember(authority);
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
  onStepped: () => void
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
      if (live.role === 'replay') {
        throw new Error(
          'MatchRunner.fromReplay: drive the runner with fastForward(replay.log, { throughTick: replay.lastTick })'
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
      onStepped();
    },
    tick: () => live.runner.tick,
    snapshot: () => live.runner.snapshot(),
    restore(bytes: Uint8Array): void {
      session.currentPeer = id;
      live.runner.restore(bytes);
    },
    async fastForward(entries, throughTick): Promise<void> {
      session.currentPeer = id;
      await live.runner.fastForward(entries as readonly EngineLogEntry[], {
        budgetMs: 250,
        throughTick,
      });
    },
    digest: () => live.runner.digest(),
    stateDump: (): StateDump => {
      const dump = live.runner.sim.stateDump();
      return dump;
    },
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
    throwBot: false,
    poolProbe: false,
    legacySpawnWithId: false,
  };
  const game = createSkirmishGame(session);
  const record = replay as unknown as ReplayRecord<SkirmishConfig>;
  // ReplayFile is the JSON form of ReplayRecord. The runner checks
  // format, game id, sim version, and tick bounds itself.
  const runner = MatchRunner.fromReplay(game, record);
  const transport = LocalTransport.manual();
  const live: Live = {
    runner,
    transport,
    role: 'replay',
    started: false,
    outcomeText: null,
  };
  runner.onOutcome((outcome) => {
    live.outcomeText =
      outcome.kind === 'win'
        ? `win:${String(outcome.winnerTeam)}`
        : `draw:${outcome.reason}`;
  });
  return wrapPeer('replay', live, session, () => undefined);
}

function toConfig(spec: MatchSpec): SkirmishConfig {
  return {
    matchId: 'skirmish',
    gameId: 'skirmish',
    simVersion: 'skirmish-1',
    seed: spec.seed >>> 0,
    simMode: 'client',
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
