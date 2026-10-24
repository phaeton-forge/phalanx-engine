import { Phalanx } from '@phalanx-engine/server';
import type {
  ServerSimHook,
  ServerSimRoom,
} from '@phalanx-engine/protocol';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PhalanxClient,
  type MatchSnapshot,
  type RoomErrorEvent,
  type ServerDesyncEvent,
} from '../src/index.js';

const GAME_ID = 'fake-sim';

/**
 * Protocol-only stand-in for the runtime sim. It records snapshot
 * requests and turns every client hash into a `desync`; the test
 * answers snapshots by hand.
 */
function fakeSim() {
  const state = {
    available: true,
    room: null as ServerSimRoom | null,
    requests: [] as { playerId: string; requestId: number }[],
  };
  const hook: ServerSimHook = {
    start: () =>
      Promise.resolve({
        games: [{ id: GAME_ID, tickRate: 20, configKeys: [] }],
      }),
    isAvailable: () => state.available,
    openMatch(spec, room) {
      state.room = room;
      return {
        matchConfig: {
          matchId: spec.matchId,
          gameId: spec.gameId,
          seed: spec.seed,
          side: 'server',
          slots: spec.slots,
        },
        publishBatch() {},
        leadExceeded: () => false,
        acceptCommand: () => true,
        clientHash(playerId, tick) {
          room.emitToPlayer(playerId, 'desync', { playerId, tick });
        },
        requestSnapshot(playerId, requestId) {
          state.requests.push({ playerId, requestId });
        },
        latestSnapshotTick: () => undefined,
        setController() {},
        end: () => Promise.resolve(),
      };
    },
    close: () => Promise.resolve(),
  };
  return { hook, state };
}

const servers: Phalanx[] = [];
const clients: PhalanxClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.stop();
});

async function start(hook: ServerSimHook): Promise<number> {
  const server = new Phalanx({
    port: 0,
    tickRate: 20,
    countdownSeconds: 0,
    disconnectTicks: 100000,
    timeoutTicks: 100000,
    sim: hook,
  });
  servers.push(server);
  await server.start();
  return server.getPort();
}

async function connected(port: number, playerId: string) {
  const client = new PhalanxClient({
    serverUrl: `http://127.0.0.1:${String(port)}`,
    playerId,
    username: playerId,
    socketTransports: ['websocket'],
    autoReconnect: false,
  });
  clients.push(client);
  await client.connect();
  return client;
}

/** `createRoom` sends no `matchConfig`; emit on the client's own socket. */
function createServerRoom(client: PhalanxClient): void {
  const socket = (client as unknown as { socketManager: { socket: Socket } })
    .socketManager.socket;
  const playerId = client.getPlayerId();
  socket.emit('room-create', {
    playerId,
    username: playerId,
    matchConfig: {
      gameId: GAME_ID,
      simMode: 'server',
      slots: [
        { slot: 0, team: 0, kind: 'human', playerId },
        {
          slot: 1,
          team: 1,
          kind: 'bot',
          policy: 'idle',
          level: 0,
          runsOn: 'server',
        },
      ],
    },
  });
}

async function inServerMatch(port: number, playerId: string) {
  const client = await connected(port, playerId);
  const started = new Promise<void>((resolve) => {
    client.on('gameStart', () => resolve());
  });
  createServerRoom(client);
  await started;
  return client;
}

describe('PhalanxClient server simulation protocol', () => {
  it('shares one match-snapshot between callers up to its requestId', async () => {
    const sim = fakeSim();
    const client = await inServerMatch(await start(sim.hook), 'snap');
    const first = client.requestMatchSnapshot();
    const second = client.requestMatchSnapshot();
    await vi.waitFor(() => {
      expect(sim.state.requests.map((item) => item.requestId)).toEqual([1, 2]);
    });
    const bytes = new Uint8Array([9, 8, 7]);
    sim.state.room?.emitToPlayer('snap', 'match-snapshot', {
      tick: 40,
      bytes,
      requestId: 2,
    });
    const results: MatchSnapshot[] = await Promise.all([first, second]);
    for (const result of results) {
      expect(result.tick).toBe(40);
      expect(result.requestId).toBe(2);
      expect(result.bytes).toBeInstanceOf(Uint8Array);
      expect([...result.bytes]).toEqual([9, 8, 7]);
    }

    const third = client.requestMatchSnapshot();
    const fourth = client.requestMatchSnapshot();
    await vi.waitFor(() => {
      expect(sim.state.requests).toHaveLength(4);
    });
    sim.state.room?.emitToPlayer('snap', 'match-snapshot', {
      tick: 60,
      bytes,
      requestId: 3,
    });
    await expect(third).resolves.toMatchObject({ tick: 60, requestId: 3 });
    let settled = false;
    void fourth.then(
      () => (settled = true),
      () => (settled = true)
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    client.disconnect();
    await expect(fourth).rejects.toThrow(/disconnected/);
  });

  it('rejects requestMatchSnapshot when not connected', async () => {
    const client = new PhalanxClient({
      serverUrl: 'http://127.0.0.1:9',
      playerId: 'offline',
    });
    clients.push(client);
    await expect(client.requestMatchSnapshot()).rejects.toThrow(
      /Not connected/
    );
  });

  it('emits serverDesync for the server desync event', async () => {
    const sim = fakeSim();
    const client = await inServerMatch(await start(sim.hook), 'hash');
    const seen: ServerDesyncEvent[] = [];
    client.on('serverDesync', (event) => seen.push(event));
    client.submitStateHash(60, 'local-hash');
    await vi.waitFor(() => {
      expect(seen).toEqual([{ playerId: 'hash', tick: 60 }]);
    });
  });

  it("surfaces room-error reason 'sim-unavailable'", async () => {
    const sim = fakeSim();
    sim.state.available = false;
    const client = await connected(await start(sim.hook), 'down');
    const error = new Promise<RoomErrorEvent>((resolve) => {
      client.on('roomError', resolve);
    });
    createServerRoom(client);
    await expect(error).resolves.toMatchObject({ reason: 'sim-unavailable' });
  });
});
