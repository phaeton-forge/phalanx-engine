import { describe, it, expect, afterEach, vi } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/index.js';
import type {
  MatchFoundEvent,
  ServerShutdownEvent,
} from '../src/types/index.js';

const PORT = 3462;

const servers: Phalanx[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
  for (const server of servers.splice(0)) {
    await server.stop();
  }
});

async function startServer(
  overrides: ConstructorParameters<typeof Phalanx>[0] = {}
): Promise<{ server: Phalanx; url: string }> {
  const server = new Phalanx({
    port: PORT,
    tickMode: 'event',
    countdownSeconds: 0,
    readyTimeoutMs: 5000,
    matchmakingIntervalMs: 60_000,
    cors: { origin: '*' },
    ...overrides,
  });
  await server.start();
  servers.push(server);
  return { server, url: `http://127.0.0.1:${PORT}` };
}

function connect(url: string): Promise<Socket> {
  const socket = io(url, { forceNew: true, transports: ['websocket'] });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err: Error) => reject(err));
  });
}

function onceEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (payload: T) => resolve(payload));
  });
}

async function openMatch(
  url: string,
  ids: { host: string; guest: string }
): Promise<{ host: Socket; guest: Socket; matchId: string }> {
  const host = await connect(url);
  const guest = await connect(url);
  const created = onceEvent<{ code: string }>(host, 'room-created');
  host.emit('room-create', { playerId: ids.host, username: ids.host });
  const { code } = await created;
  const found = onceEvent<MatchFoundEvent>(host, 'match-found');
  const started = Promise.all([
    onceEvent(host, 'game-start'),
    onceEvent(guest, 'game-start'),
  ]);
  guest.emit('room-join', {
    playerId: ids.guest,
    username: ids.guest,
    code,
  });
  const match = await found;
  await started;
  return { host, guest, matchId: match.matchId };
}

describe('Phalanx.shutdown', () => {
  it('emits server-shutdown to every match before match-end stopped', async () => {
    const { server, url } = await startServer();
    const first = await openMatch(url, { host: 'p1', guest: 'p2' });
    const second = await openMatch(url, { host: 'p3', guest: 'p4' });
    const players = [first.host, first.guest, second.host, second.guest];

    const orders = players.map((socket) => {
      const seen: string[] = [];
      socket.on('server-shutdown', () => {
        seen.push('shutdown');
      });
      socket.on('match-end', (payload: { reason: string }) => {
        if (payload.reason === 'stopped') seen.push('stopped');
      });
      return seen;
    });

    const payloads = players.map((socket) =>
      onceEvent<ServerShutdownEvent>(socket, 'server-shutdown')
    );
    const ended = players.map((socket) =>
      onceEvent<{ reason: string }>(socket, 'match-end')
    );

    await server.shutdown('deploy');

    const events = await Promise.all(payloads);
    const ends = await Promise.all(ended);
    const expectedIds = [first.matchId, second.matchId].sort();
    for (const event of events) {
      expect(event.reason).toBe('deploy');
      expect([...event.matchIds].sort()).toEqual(expectedIds);
      expect(event).toEqual(events[0]);
    }
    for (const end of ends) {
      expect(end.reason).toBe('stopped');
    }
    for (const seen of orders) {
      expect(seen).toEqual(['shutdown', 'stopped']);
    }
  });

  it('waits shutdownGraceMs before stop', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    const server = new Phalanx({
      port: PORT,
      shutdownGraceMs: 500,
      matchmakingIntervalMs: 60_000,
      cors: { origin: '*' },
    });
    servers.push(server);
    await server.start();

    let settled = false;
    const pending = server.shutdown('deploy');
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });

  it('returns the same promise from a second shutdown call', async () => {
    const { server, url } = await startServer();
    const { host } = await openMatch(url, { host: 'p1', guest: 'p2' });
    let shutdowns = 0;
    host.on('server-shutdown', () => {
      shutdowns += 1;
    });
    const first = server.shutdown('deploy');
    const second = server.shutdown('again');
    expect(second).toBe(first);
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    expect(shutdowns).toBe(1);
  });

  it('does not install a SIGTERM listener unless handleSignals is set', async () => {
    const before = process.listenerCount('SIGTERM');
    const { server } = await startServer({ handleSignals: false });
    expect(process.listenerCount('SIGTERM')).toBe(before);
    await server.stop();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('registers one SIGTERM listener in start and removes it in stop', async () => {
    const before = process.listenerCount('SIGTERM');
    const { server } = await startServer({ handleSignals: true });
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    await server.stop();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});
