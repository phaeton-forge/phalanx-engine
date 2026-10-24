import {
  MatchSessionStore,
  MemoryKeyValueStorage,
  PhalanxClient,
  type ServerDesyncEvent,
} from '@phalanx-engine/client';
import { Phalanx, type PhalanxConfig } from '@phalanx-engine/server';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchRunner } from '../../src/index.js';
import { ServerPeerTransport } from '../../src/net/index.js';
import { createServerSim } from '../../src/server/createServerSim.js';
import { RELAY_CONFIG_KEYS, RelayGame } from '../server/fixtures/relayGame.js';

const fixtureHref = new URL('../server/fixtures/relayGame.ts', import.meta.url)
  .href;
const GAME_ID = RelayGame.id;
const SECRET = 'server-peer-test-secret-0123456789abcdef';

const servers: Phalanx[] = [];
const clients: PhalanxClient[] = [];
const runners: MatchRunner<typeof RelayGame>[] = [];

afterEach(async () => {
  for (const runner of runners.splice(0)) runner.dispose();
  for (const client of clients.splice(0)) client.disconnect();
  for (const server of servers.splice(0)) await server.stop();
});

interface Harness {
  readonly server: Phalanx;
  /** `sim-digest` by tick. */
  readonly serverDigests: Map<number, string>;
}

async function startServer(mode: 'inProcess' | 'worker'): Promise<Harness> {
  const config: Partial<PhalanxConfig> = {
    port: 0,
    tickRate: RelayGame.tickRate,
    countdownSeconds: 0,
    disconnectTicks: 100000,
    timeoutTicks: 100000,
    playersConnectTimeoutMs: 20000,
    readyTimeoutMs: 10000,
    session: { secret: SECRET },
    sim: createServerSim({
      games: [
        {
          module: fixtureHref,
          export: 'RelayGame',
          configKeys: [...RELAY_CONFIG_KEYS],
        },
      ],
      mode,
      snapshotEveryTicks: 20,
    }),
  };
  const server = new Phalanx(config);
  servers.push(server);
  await server.start();
  const serverDigests = new Map<number, string>();
  server.on('sim-digest', (_matchId: string, tick: number, digest: string) => {
    serverDigests.set(tick, digest);
  });
  return { server, serverDigests };
}

function newClient(port: number, playerId: string): PhalanxClient {
  const client = new PhalanxClient({
    serverUrl: `http://127.0.0.1:${String(port)}`,
    playerId,
    username: playerId,
    tickRate: RelayGame.tickRate,
    socketTransports: ['websocket'],
    autoReconnect: false,
  });
  clients.push(client);
  return client;
}

/**
 * `PhalanxClient.createRoom` sends no `matchConfig`. A server room is
 * created on the client's own socket so `game-start` reaches it.
 */
function createServerRoom(client: PhalanxClient, playerId: string): void {
  const socket = (client as unknown as { socketManager: { socket: Socket } })
    .socketManager.socket;
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
          policy: 'walker',
          level: 0,
          runsOn: 'server',
        },
      ],
    },
  });
}

interface Joined {
  readonly runner: MatchRunner<typeof RelayGame>;
  readonly digests: Map<number, string>;
  readonly desyncs: ServerDesyncEvent[];
  readonly errors: unknown[];
}

function observe(
  client: PhalanxClient,
  runner: MatchRunner<typeof RelayGame>
): Joined {
  runners.push(runner);
  const digests = new Map<number, string>();
  const desyncs: ServerDesyncEvent[] = [];
  const errors: unknown[] = [];
  runner.onDigest((tick, digest) => {
    digests.set(tick, digest);
  });
  runner.onError((error) => {
    errors.push(error);
  });
  client.on('serverDesync', (event) => {
    desyncs.push(event);
  });
  return { runner, digests, desyncs, errors };
}

async function freshJoin(
  port: number,
  playerId: string,
  sessionStore: MatchSessionStore
): Promise<{ client: PhalanxClient; joined: Joined }> {
  const client = newClient(port, playerId);
  await client.connect();
  const transport = new ServerPeerTransport({
    client,
    gameId: GAME_ID,
    sessionStore,
  });
  const pending = MatchRunner.join(RelayGame, transport);
  createServerRoom(client, playerId);
  const runner = await pending;
  return { client, joined: observe(client, runner) };
}

/** Hash ticks after `afterTick` where both sides published and agree. */
function agreedAfter(
  harness: Harness,
  joined: Joined,
  afterTick: number
): number[] {
  const agreed: number[] = [];
  for (const [tick, digest] of joined.digests) {
    if (tick <= afterTick) continue;
    if (harness.serverDigests.get(tick) === digest) agreed.push(tick);
  }
  return agreed.sort((a, b) => a - b);
}

function expectNoMismatch(harness: Harness, joined: Joined): void {
  for (const [tick, digest] of joined.digests) {
    const server = harness.serverDigests.get(tick);
    if (server !== undefined)
      expect(digest, `tick ${String(tick)}`).toBe(server);
  }
}

const WAIT = { timeout: 20_000, interval: 20 };

describe('ServerPeerTransport + MatchRunner.join', () => {
  it.each(['inProcess', 'worker'] as const)(
    'fresh join keeps the client digest equal to the server (%s)',
    async (mode) => {
      const harness = await startServer(mode);
      const store = new MatchSessionStore(GAME_ID, new MemoryKeyValueStorage());
      const { joined } = await freshJoin(
        harness.server.getPort(),
        'p-fresh',
        store
      );
      expect(joined.runner.status).toBe('running');
      await vi.waitFor(() => {
        expect(joined.runner.tick).toBeGreaterThanOrEqual(
          mode === 'worker' ? 200 : 500
        );
        expect(agreedAfter(harness, joined, -1).length).toBeGreaterThanOrEqual(
          mode === 'worker' ? 3 : 8
        );
      }, WAIT);
      expectNoMismatch(harness, joined);
      expect(joined.desyncs).toEqual([]);
      expect(joined.errors).toEqual([]);
      expect(store.load()?.matchConfig).toBeDefined();
    }
  );

  it('resumes a reloaded tab from the stored session', async () => {
    const harness = await startServer('inProcess');
    const store = new MatchSessionStore(GAME_ID, new MemoryKeyValueStorage());
    const first = await freshJoin(harness.server.getPort(), 'p-reload', store);
    await vi.waitFor(() => {
      expect(first.joined.runner.tick).toBeGreaterThanOrEqual(90);
    }, WAIT);
    const session = store.load();
    expect(session?.token).toBeTruthy();
    expect(session?.matchConfig).toBeDefined();
    first.joined.runner.dispose();
    first.client.disconnect();

    const client = newClient(harness.server.getPort(), 'p-reload');
    const transport = new ServerPeerTransport({
      client,
      gameId: GAME_ID,
      sessionStore: store,
    });
    const snapshots = vi.spyOn(client, 'requestMatchSnapshot');
    const logs = vi.spyOn(client, 'fetchMatchLog');
    const runner = await MatchRunner.join(RelayGame, transport);
    const joined = observe(client, runner);
    expect(snapshots).toHaveBeenCalledTimes(1);
    const snapshot = await snapshots.mock.results[0]?.value;
    expect(snapshot.tick).toBeGreaterThanOrEqual(20);
    expect(logs).toHaveBeenCalledWith(snapshot.tick + 1);
    const resumedAt = runner.tick;
    expect(resumedAt).toBeGreaterThanOrEqual(90);

    const seen: number[] = [];
    runner.onTick((tick) => {
      seen.push(tick);
    });
    await vi.waitFor(() => {
      expect(
        agreedAfter(harness, joined, resumedAt).length
      ).toBeGreaterThanOrEqual(2);
    }, WAIT);
    expectNoMismatch(harness, joined);
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).toBe((seen[index - 1] ?? 0) + 1);
    }
    expect(seen[0]).toBe(resumedAt + 1);
    expect(joined.errors).toEqual([]);
    expect(joined.desyncs).toEqual([]);
  });

  it('recovers from a forced desync twice', async () => {
    const harness = await startServer('inProcess');
    const store = new MatchSessionStore(GAME_ID, new MemoryKeyValueStorage());
    const { client, joined } = await freshJoin(
      harness.server.getPort(),
      'p-desync',
      store
    );
    const resyncs = vi.spyOn(ServerPeerTransport.prototype, 'requestResync');
    for (let round = 1; round <= 2; round += 1) {
      await vi.waitFor(() => {
        expect(joined.runner.tick % 60).toBeGreaterThan(5);
        expect(joined.runner.tick % 60).toBeLessThan(40);
      }, WAIT);
      const desyncsBefore = joined.desyncs.length;
      const resyncsBefore = resyncs.mock.calls.length;
      const corruptedAt = joined.runner.tick;
      joined.runner.sim.x += 1000;
      await vi.waitFor(() => {
        expect(joined.desyncs.length).toBeGreaterThan(desyncsBefore);
      }, WAIT);
      expect(joined.desyncs[desyncsBefore]?.playerId).toBe(
        client.getPlayerId()
      );
      await vi.waitFor(() => {
        expect(resyncs.mock.calls.length).toBeGreaterThan(resyncsBefore);
        // The first hash tick after the corruption mismatched; a later
        // one agreeing means the restored state is the server's.
        const agreed = agreedAfter(harness, joined, corruptedAt + 60);
        expect(agreed.length).toBeGreaterThanOrEqual(1);
      }, WAIT);
    }
    expect(joined.errors).toEqual([]);
  });
});
