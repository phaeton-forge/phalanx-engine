import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import {
  DEFAULT_INPUT_DELAY_TICKS,
  type GameStartEvent,
  type PlayerCommand,
  type ServerSimHook,
  type ServerSimInfo,
  type ServerSimMatch,
  type ServerSimMatchSpec,
  type ServerSimRoom,
} from '@phalanx-engine/protocol';
import { Phalanx } from '../src/Phalanx.js';

const servers: Phalanx[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0, sockets.length)) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  for (const server of servers.splice(0, servers.length)) {
    await server.stop();
  }
});

function connect(port: number): Promise<Socket> {
  const socket = io(`http://127.0.0.1:${String(port)}`, {
    transports: ['websocket'],
    forceNew: true,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error: Error) => reject(error));
  });
}

function onceEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (data: T) => resolve(data));
  });
}

async function start(
  config: ConstructorParameters<typeof Phalanx>[0]
): Promise<Phalanx> {
  const server = new Phalanx({
    port: 0,
    tickRate: 20,
    countdownSeconds: 0,
    ...config,
  });
  servers.push(server);
  await server.start();
  return server;
}

function humanBot(playerId: string) {
  return {
    gameId: 'fake',
    simMode: 'server' as const,
    slots: [
      { slot: 0, team: 0, kind: 'human' as const, playerId },
      {
        slot: 1,
        team: 1,
        kind: 'bot' as const,
        policy: 'walker',
        level: 0,
        runsOn: 'server' as const,
      },
    ],
  };
}

function fakeSim(options?: { available?: boolean; maxMatches?: number }): {
  hook: ServerSimHook;
  published: number[];
  ended: string[];
} {
  const published: number[] = [];
  const ended: string[] = [];
  const hook: ServerSimHook = {
    start() {
      return Promise.resolve({
        games: [{ id: 'fake', tickRate: 20, configKeys: [] }],
        ...(options?.maxMatches !== undefined
          ? { maxMatches: options.maxMatches }
          : {}),
      });
    },
    isAvailable() {
      return options?.available !== false;
    },
    openMatch(spec: ServerSimMatchSpec, _room: ServerSimRoom): ServerSimMatch {
      return {
        matchConfig: { gameId: spec.gameId },
        publishBatch(tick: number, _commands: readonly PlayerCommand[]) {
          published.push(tick);
        },
        leadExceeded() {
          return false;
        },
        acceptCommand() {
          return true;
        },
        clientHash() {},
        requestSnapshot() {},
        latestSnapshotTick() {
          return undefined;
        },
        setController() {},
        end() {
          ended.push(spec.matchId);
          return Promise.resolve();
        },
      };
    },
    close() {
      return Promise.resolve();
    },
  };
  return { hook, published, ended };
}

describe('server sim hook', () => {
  it('runs a relay match when sim is omitted', async () => {
    const server = await start({});
    const host = await connect(server.getPort());
    const guest = await connect(server.getPort());
    const created = onceEvent<{ code: string }>(host, 'room-created');
    host.emit('room-create', { playerId: 'host', username: 'host' });
    const room = await created;
    const hostFound = onceEvent(host, 'match-found');
    const guestFound = onceEvent(guest, 'match-found');
    guest.emit('room-join', {
      playerId: 'guest',
      username: 'guest',
      code: room.code,
    });
    await hostFound;
    await guestFound;
    const batch = onceEvent(host, 'commands-batch');
    host.emit('client-ready');
    guest.emit('client-ready');
    await batch;
  });

  it('rejects simMode server when no sim is configured', async () => {
    const server = await start({});
    const socket = await connect(server.getPort());
    const error = onceEvent<{ message: string }>(socket, 'room-error');
    socket.emit('room-create', {
      playerId: 'host',
      username: 'host',
      matchConfig: humanBot('host'),
    });
    expect((await error).message).toBe('Server simulation is not configured');
  });

  it('opens a match through a fake hook and ends it', async () => {
    const sim = fakeSim();
    const server = await start({ sim: sim.hook });
    const socket = await connect(server.getPort());
    const started = onceEvent(socket, 'game-start');
    socket.emit('room-create', {
      playerId: 'host',
      username: 'host',
      matchConfig: humanBot('host'),
    });
    await started;
    socket.emit('client-ready');
    const deadline = Date.now() + 2000;
    while (sim.published.length === 0) {
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(sim.published.length).toBeGreaterThan(0);
    await server.stop();
    expect(sim.ended.length).toBe(1);
  });

  it('reports sim-unavailable when the hook is down', async () => {
    const sim = fakeSim({ available: false });
    const server = await start({ sim: sim.hook });
    const socket = await connect(server.getPort());
    const error = onceEvent<{ message: string; reason?: string }>(
      socket,
      'room-error'
    );
    socket.emit('room-create', {
      playerId: 'host',
      username: 'host',
      matchConfig: humanBot('host'),
    });
    expect(await error).toEqual({
      message: 'Server simulation is unavailable',
      reason: 'sim-unavailable',
    });
  });

  it('respects maxMatches', async () => {
    const sim = fakeSim({ maxMatches: 1 });
    const server = await start({ sim: sim.hook });
    const first = await connect(server.getPort());
    const started = onceEvent(first, 'game-start');
    first.emit('room-create', {
      playerId: 'one',
      username: 'one',
      matchConfig: humanBot('one'),
    });
    await started;
    const second = await connect(server.getPort());
    const error = onceEvent<{ message: string }>(second, 'room-error');
    second.emit('room-create', {
      playerId: 'two',
      username: 'two',
      matchConfig: humanBot('two'),
    });
    expect((await error).message).toBe('Server match capacity reached');
  });

  it('rejects a sim tick rate that does not match and closes the hook', async () => {
    const probe = tickingHook({ tickRate: 30 });
    await expect(start({ sim: probe.hook })).rejects.toThrow(
      "game 'fake' tickRate 30 does not match server tickRate 20"
    );
    expect(probe.closes).toBe(1);
  });

  it('rejects a non-continuous tick mode and closes the hook', async () => {
    const probe = tickingHook({ tickRate: 20 });
    await expect(start({ sim: probe.hook, tickMode: 'event' })).rejects.toThrow(
      "game 'fake' requires continuous tickMode, got 'event'"
    );
    expect(probe.closes).toBe(1);
  });

  it('opens a match with the relay spec unchanged', async () => {
    const specs: ServerSimMatchSpec[] = [];
    const sim = fakeSim();
    const hook: ServerSimHook = {
      ...sim.hook,
      openMatch(spec, room) {
        specs.push(spec);
        return sim.hook.openMatch(spec, room);
      },
    };
    const server = await start({ sim: hook, maxTickAhead: 9 });
    const socket = await connect(server.getPort());
    const started = onceEvent<GameStartEvent>(socket, 'game-start');
    socket.emit('room-create', {
      playerId: 'host',
      username: 'host',
      matchConfig: { ...humanBot('host'), inputDelayTicks: 3 },
    });
    const gameStart = await started;
    expect(specs).toHaveLength(1);
    const spec = specs[0];
    expect(spec).toBeDefined();
    if (spec === undefined) return;
    expect(spec.matchId).toBe(gameStart.matchId);
    expect(spec.gameId).toBe('fake');
    expect(spec.seed).toBe(gameStart.randomSeed);
    expect(spec.inputDelayTicks).toBe(3);
    expect(spec.inputDelayTicks).not.toBe(DEFAULT_INPUT_DELAY_TICKS);
    expect(spec.maxTickAhead).toBe(9);
    expect(spec.extras).toEqual({});
    expect(spec.slots).toEqual([
      { slot: 0, team: 0, kind: 'human', playerId: 'host' },
      {
        slot: 1,
        team: 1,
        kind: 'bot',
        policy: 'walker',
        level: 0,
        runsOn: 'server',
      },
    ]);
  });
});

function tickingHook(game: { tickRate: number }): {
  hook: ServerSimHook;
  closes: number;
} {
  const state = { closes: 0 };
  const info: ServerSimInfo = {
    games: [{ id: 'fake', tickRate: game.tickRate, configKeys: [] }],
  };
  const hook: ServerSimHook = {
    start: () => Promise.resolve(info),
    isAvailable: () => true,
    openMatch(): ServerSimMatch {
      throw new Error('tick check should reject before openMatch');
    },
    close: () => {
      state.closes += 1;
      return Promise.resolve();
    },
  };
  return {
    hook,
    get closes() {
      return state.closes;
    },
  };
}
