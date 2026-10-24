import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SlotConfig } from '@phalanx-engine/runtime';
import { RoomSim } from '../../src/server/RoomSim.js';
import { SimProcess } from '../../src/server/simCore.js';
import { SnapshotStore } from '../../src/server/SnapshotStore.js';
import {
  simFaultKind,
  type SimIn,
  type SimOut,
} from '../../src/server/messages.js';
import type { RegisteredGame } from '../../src/server/loadGames.js';
import type { SimHost } from '../../src/server/SimHost.js';
import { RelayGame } from './fixtures/relayGame.js';

const slots: SlotConfig[] = [
  { slot: 0, team: 0, kind: 'human', playerId: 'p1' },
  {
    slot: 1,
    team: 1,
    kind: 'bot',
    policy: 'walker',
    level: 0,
    runsOn: 'server',
  },
];

function harness(): {
  posts: SimIn[];
  delivered: { playerId: string; requestId: number }[];
  desyncs: string[];
  sim: RoomSim;
} {
  const posts: SimIn[] = [];
  const delivered: { playerId: string; requestId: number }[] = [];
  const desyncs: string[] = [];
  const host: SimHost = {
    mode: 'inProcess',
    post(message) {
      posts.push(message);
    },
    subscribe() {
      return () => {};
    },
    close() {
      return Promise.resolve();
    },
    activeMatches() {
      return 0;
    },
    healthy() {
      return true;
    },
  };
  const game: RegisteredGame = {
    id: 'relay-fixture',
    simVersion: 'relay-1',
    tickRate: 64,
    moduleHref: '',
    definition: RelayGame,
    inline: true,
    configKeys: [],
  };
  const sim = new RoomSim({
    matchId: 'm',
    host,
    store: new SnapshotStore(),
    game,
    seed: 1,
    slots,
    inputDelayTicks: 2,
    maxTickAhead: 5,
    snapshotEveryTicks: 1000,
    extras: {},
    room: {
      enqueue() {},
      currentTick: () => 0,
      endMatch: () => true,
      emitToPlayer(playerId, _event, payload) {
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'requestId' in payload &&
          typeof payload.requestId === 'number'
        ) {
          delivered.push({ playerId, requestId: payload.requestId });
        }
      },
      emitServerEvent(event, ...args) {
        if (event !== 'desync-detected') return;
        const hashes = args[2];
        if (typeof hashes !== 'object' || hashes === null) return;
        for (const playerId of Object.keys(hashes)) {
          if (playerId !== 'server') desyncs.push(playerId);
        }
      },
      haltRelay() {},
      releaseHold() {},
      onClosed() {},
    },
  });
  return { posts, delivered, desyncs, sim };
}

describe('RoomSim', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('coalesces two players onto one sim snapshot and keeps each request id', () => {
    const { posts, delivered, sim } = harness();
    sim.requestSnapshot('p1', 1);
    sim.requestSnapshot('p2', 7);
    expect(posts.filter((message) => message.t === 'snapshot')).toHaveLength(1);
    sim.onMessage({
      t: 'snapshot',
      matchId: 'm',
      tick: 3,
      requestId: 0,
      bytes: new ArrayBuffer(4),
    });
    expect(delivered).toHaveLength(2);
    expect(delivered).toEqual(
      expect.arrayContaining([
        { playerId: 'p1', requestId: 1 },
        { playerId: 'p2', requestId: 7 },
      ])
    );
  });

  it('delivers at most two snapshots for many request ids', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    const { posts, delivered, sim } = harness();
    const count = 40;
    for (let requestId = 1; requestId <= count; requestId += 1) {
      sim.requestSnapshot('p1', requestId);
    }
    const shots = posts.filter((message) => message.t === 'snapshot');
    expect(shots).toHaveLength(1);
    sim.onMessage({ t: 'tick', matchId: 'm', tick: 4 });
    sim.onMessage({
      t: 'snapshot',
      matchId: 'm',
      tick: 4,
      requestId: 0,
      bytes: new ArrayBuffer(4),
    });
    for (let requestId = count + 1; requestId <= count * 2; requestId += 1) {
      sim.requestSnapshot('p1', requestId);
    }
    expect(delivered.length).toBeLessThanOrEqual(2);
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered[0]).toEqual({ playerId: 'p1', requestId: count });
  });

  it('sends at most three snapshots across two seconds of requests', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    const { posts, delivered, sim } = harness();
    for (let step = 0; step < 100; step += 1) {
      const ack = step + 1;
      sim.onMessage({ t: 'tick', matchId: 'm', tick: ack });
      sim.requestSnapshot('p1', step);
      const shots = posts.filter((message) => message.t === 'snapshot');
      if (shots.length > delivered.length) {
        sim.onMessage({
          t: 'snapshot',
          matchId: 'm',
          tick: ack - 1,
          bytes: new ArrayBuffer(1),
        });
      }
      vi.advanceTimersByTime(20);
    }
    const shots = posts.filter((message) => message.t === 'snapshot');
    expect(shots.length).toBeLessThanOrEqual(3);
    expect(delivered.length).toBeLessThanOrEqual(3);
    expect(delivered.length).toBeGreaterThan(0);
  });

  it('drops off-cadence, far-ahead, and excess pending hashes', () => {
    const { desyncs, sim } = harness();
    sim.clientHash('p1', 1, 'off-cadence');
    sim.clientHash('p1', 120, 'too-far');
    sim.onMessage({
      t: 'digest',
      matchId: 'm',
      tick: 1,
      digest: 'server',
    });
    sim.onMessage({
      t: 'digest',
      matchId: 'm',
      tick: 120,
      digest: 'server',
    });
    expect(desyncs).toEqual([]);
    for (let index = 0; index < 40; index += 1) {
      sim.clientHash(`p${String(index)}`, 0, 'bad');
    }
    sim.onMessage({ t: 'digest', matchId: 'm', tick: 0, digest: 'good' });
    expect(desyncs).toHaveLength(32);
    sim.clientHash('p39', 0, 'bad-again');
    expect(desyncs).toHaveLength(32);
  });

  it('reports desync again only after a snapshot reached that player', () => {
    const { desyncs, sim } = harness();
    sim.onMessage({ t: 'digest', matchId: 'm', tick: 0, digest: 'good' });
    sim.clientHash('p1', 0, 'bad');
    sim.clientHash('p2', 0, 'bad');
    expect(desyncs).toEqual(['p1', 'p2']);
    sim.clientHash('p1', 0, 'bad-again');
    expect(desyncs).toEqual(['p1', 'p2']);
    sim.requestSnapshot('p1', 1);
    sim.onMessage({
      t: 'snapshot',
      matchId: 'm',
      tick: 0,
      requestId: 0,
      bytes: new ArrayBuffer(4),
    });
    sim.clientHash('p2', 0, 'bad-again');
    expect(desyncs).toEqual(['p1', 'p2']);
    sim.clientHash('p1', 0, 'bad-after-snapshot');
    expect(desyncs).toEqual(['p1', 'p2', 'p1']);
  });
});

describe('simFaultKind', () => {
  it('does not treat a game error string as an out-of-memory kill', () => {
    expect(simFaultKind(new Error('out of memory'))).toBe('sim-error');
    expect(simFaultKind(new Error('allocation failed'))).toBe('sim-error');
    const crash = new Error('process.exit(1)');
    crash.name = 'SimCrashError';
    expect(simFaultKind(crash)).toBe('sim-crash');
    expect(
      simFaultKind(
        Object.assign(new Error('heap'), { code: 'ERR_WORKER_OUT_OF_MEMORY' })
      )
    ).toBe('sim-oom');
  });
});

describe('SimProcess snapshots', () => {
  it('stores a snapshot only on the configured cadence', async () => {
    const received: SimOut[] = [];
    const process = new SimProcess(
      {
        send(message) {
          received.push(message);
        },
      },
      { yieldBetween: false }
    );
    process.install(RelayGame);
    process.push({
      t: 'open',
      matchId: 'm',
      module: '',
      config: {
        matchId: 'm',
        gameId: 'relay-fixture',
        simVersion: 'relay-1',
        seed: 1,
        side: 'server',
        inputDelayTicks: 2,
        slots,
      },
      snapshotEveryTicks: 5,
      hashEveryTicks: 60,
    });
    await process.whenIdle();
    for (let tick = 0; tick < 12; tick += 1) {
      process.push({ t: 'batch', matchId: 'm', tick, commands: [] });
      await process.whenIdle();
    }
    const ticks = received.flatMap((message) =>
      message.t === 'snapshot' ? [message.tick] : []
    );
    expect(ticks).toEqual([5, 10]);
  });
});
