import { DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS } from '../constants.js';
import type { AnyGameDefinition } from '../game/GameDefinition.js';
import type {
  ServerSimHook,
  ServerSimInfo,
  ServerSimMatch,
  ServerSimMatchSpec,
  ServerSimRoom,
} from '@phalanx-engine/protocol';
import { loadGameCatalog, type RegisteredGame } from './loadGames.js';
import { RoomSim } from './RoomSim.js';
import { createSimHost, type SimHost } from './SimHost.js';
import { SnapshotStore } from './SnapshotStore.js';
import { validateServerSim, type ServerSimConfig } from './serverSimConfig.js';

export type { ServerSimConfig } from './serverSimConfig.js';

/**
 * Server simulation behind {@link ServerSimHook}. The relay never imports
 * a game or a worker. `close` ends every match, then the host.
 */
export function createServerSim(config: ServerSimConfig): ServerSimHook {
  validateServerSim(config);
  const snapshotEveryTicks =
    config.snapshotEveryTicks ?? DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS;
  let host: SimHost | null = null;
  let unsub: (() => void) | null = null;
  let catalog: readonly RegisteredGame[] = [];
  let info: ServerSimInfo = { games: [] };
  const snapshots = new SnapshotStore();
  const sessions = new Map<string, RoomSim>();
  let started = false;

  return {
    async start(): Promise<ServerSimInfo> {
      if (started) return info;
      catalog = await loadGameCatalog(config);
      const inline = new Map<string, AnyGameDefinition>();
      for (const game of catalog) {
        if (game.inline) inline.set(game.id, game.definition);
      }
      const mode = config.mode ?? 'worker';
      const limits = config.resourceLimits;
      host = createSimHost({
        mode,
        inline,
        ...(limits !== undefined ? { resourceLimits: limits } : {}),
      });
      unsub = host.subscribe((message) => {
        if (!('matchId' in message)) return;
        sessions.get(message.matchId)?.onMessage(message);
      });
      info = {
        games: catalog.map((game) => ({
          id: game.id,
          tickRate: game.tickRate,
          configKeys: game.configKeys,
        })),
        ...(config.maxMatches !== undefined
          ? { maxMatches: config.maxMatches }
          : {}),
      };
      started = true;
      return info;
    },

    isAvailable(): boolean {
      return host?.healthy() ?? false;
    },

    openMatch(spec: ServerSimMatchSpec, room: ServerSimRoom): ServerSimMatch {
      const game = catalog.find((entry) => entry.id === spec.gameId);
      const current = host;
      if (game === undefined || current === null) {
        throw new Error(`Game '${spec.gameId}' is not registered`);
      }
      const session = new RoomSim({
        matchId: spec.matchId,
        host: current,
        store: snapshots,
        game,
        seed: spec.seed,
        slots: spec.slots,
        inputDelayTicks: spec.inputDelayTicks,
        maxTickAhead: spec.maxTickAhead,
        snapshotEveryTicks,
        extras: spec.extras,
        room: {
          enqueue: (commands) => {
            room.enqueue(commands);
          },
          currentTick: () => room.currentTick(),
          endMatch: (result) => room.endMatch(result),
          haltRelay: () => {
            room.haltRelay();
          },
          releaseHold: () => {
            room.releaseHold();
          },
          emitToPlayer: (playerId, event, payload) => {
            room.emitToPlayer(playerId, event, payload);
          },
          emitServerEvent: (event, ...args) => {
            room.emitServerEvent(event, ...args);
          },
          onClosed: () => {
            sessions.delete(spec.matchId);
            snapshots.delete(spec.matchId);
            room.onClosed();
          },
        },
      });
      sessions.set(spec.matchId, session);
      return session;
    },

    async close(): Promise<void> {
      const endings = [...sessions.values()].map((session) => session.end());
      await Promise.all(endings);
      if (host) await host.close();
      unsub?.();
      unsub = null;
      host = null;
      sessions.clear();
      started = false;
    },
  };
}
