import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server as HttpServer } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import { Phalanx } from '../src/index.js';
import { GameRoom } from '../src/services/GameRoom.js';
import { MatchmakingService } from '../src/services/MatchmakingService.js';
import { PrivateRoomService } from '../src/services/PrivateRoomService.js';
import {
  SessionTokens,
  SESSION_TOMBSTONE_TTL_MS,
} from '../src/services/SessionTokens.js';
import type {
  MatchFoundEvent,
  MatchLogChunkEvent,
  MatchResumeStateEvent,
  PhalanxConfig,
  PlayerCommand,
  SessionTokenEvent,
} from '../src/types/index.js';

/**
 * Task 9 session token and match-resume.
 * A real `Phalanx` on port 0 plus `socket.io-client`.
 */

const SECRET = '0123456789abcdef0123456789abcdef';

interface Started {
  server: Phalanx;
  url: string;
}

interface Opened {
  host: Socket;
  guest: Socket;
  matchId: string;
  code: string;
  hostToken: string;
  guestToken: string;
}

const servers: Phalanx[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  for (const server of servers.splice(0)) {
    await server.stop();
  }
});

function findRoom(server: Phalanx, matchId: string): GameRoom {
  const internal = server as unknown as {
    matchmaking: MatchmakingService | null;
    privateRooms: PrivateRoomService | null;
  };
  const room =
    internal.matchmaking?.getMatch(matchId) ??
    internal.privateRooms?.getMatch(matchId);
  if (!room) throw new Error(`no room ${matchId}`);
  return room;
}

function listeningUrl(server: Phalanx): string {
  const httpServer = (server as unknown as { httpServer: HttpServer | null })
    .httpServer;
  const address = httpServer?.address();
  if (!address || typeof address !== 'object') {
    throw new Error('Phalanx is not listening');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function startServer(
  overrides: Partial<PhalanxConfig> = {}
): Promise<Started> {
  const server = new Phalanx({
    port: 0,
    tickMode: 'event',
    countdownSeconds: 0,
    readyTimeoutMs: 20000,
    playersConnectTimeoutMs: 20000,
    turnTimeoutMs: 20000,
    matchmakingIntervalMs: 30,
    commandHistoryTicks: 'full',
    cors: { origin: '*' },
    session: { secret: SECRET },
    ...overrides,
  });
  await server.start();
  servers.push(server);
  return { server, url: listeningUrl(server) };
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
  buildIds?: { host?: string; guest?: string },
  waitForTokens = true
): Promise<Opened> {
  const host = await connect(url);
  const guest = await connect(url);
  const created = onceEvent<{ code: string }>(host, 'room-created');
  const found = onceEvent<MatchFoundEvent>(host, 'match-found');
  const guestFound = onceEvent<MatchFoundEvent>(guest, 'match-found');
  const started = Promise.all([
    onceEvent(host, 'game-start'),
    onceEvent(guest, 'game-start'),
  ]);
  const hostTokenEvent = waitForTokens
    ? onceEvent<SessionTokenEvent>(host, 'session-token')
    : Promise.resolve(undefined);
  const guestTokenEvent = waitForTokens
    ? onceEvent<SessionTokenEvent>(guest, 'session-token')
    : Promise.resolve(undefined);
  host.emit('room-create', {
    playerId: 'player1',
    username: 'Player1',
    ...(buildIds?.host !== undefined ? { buildId: buildIds.host } : {}),
  });
  const { code } = await created;
  guest.emit('room-join', {
    playerId: 'player2',
    username: 'Player2',
    code,
    ...(buildIds?.guest !== undefined ? { buildId: buildIds.guest } : {}),
  });
  const match = await found;
  await guestFound;
  await started;
  const [hostToken, guestToken] = await Promise.all([
    hostTokenEvent,
    guestTokenEvent,
  ]);
  const bothReady = new Promise<void>((resolve) => {
    const seen = new Set<string>();
    const onReady = (event: { playerId: string }) => {
      seen.add(event.playerId);
      if (seen.size < 2) return;
      host.off('player-ready', onReady);
      resolve();
    };
    host.on('player-ready', onReady);
  });
  host.emit('client-ready');
  guest.emit('client-ready');
  await bothReady;
  return {
    host,
    guest,
    matchId: match.matchId,
    code,
    hostToken: hostToken?.token ?? '',
    guestToken: guestToken?.token ?? '',
  };
}

async function waitForLength(ticks: number[], length: number): Promise<void> {
  const started = Date.now();
  while (ticks.length < length && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function playTick(
  submitter: Socket,
  observer: Socket,
  tick: number,
  n: number
): Promise<{ tick: number; commands: PlayerCommand[] }> {
  const batch = onceEvent<{ tick: number; commands: PlayerCommand[] }>(
    observer,
    'commands-batch'
  );
  submitter.emit('submit-commands', {
    tick,
    commands: [{ type: 'ping', data: { n } }],
  });
  return batch;
}

describe('match-resume', () => {
  it('issues slot tokens at game-start and does not issue them without session', async () => {
    const enabled = await startServer();
    const match = await openMatch(enabled.url);
    expect(match.hostToken.length).toBeGreaterThan(0);
    expect(match.guestToken).not.toBe(match.hostToken);
    const hostSlot = new SessionTokens({ secret: SECRET }).verify(
      match.hostToken,
      Date.now()
    );
    const guestSlot = new SessionTokens({ secret: SECRET }).verify(
      match.guestToken,
      Date.now()
    );
    expect(hostSlot.ok && hostSlot.claims.slot).toBe(0);
    expect(guestSlot.ok && guestSlot.claims.slot).toBe(1);
    expect(hostSlot.ok && hostSlot.claims.playerId).toBe('player1');
    expect(guestSlot.ok && guestSlot.claims.matchId).toBe(match.matchId);

    const plain = await startServer({ session: undefined });
    const host = await connect(plain.url);
    const guest = await connect(plain.url);
    const tokens: unknown[] = [];
    host.on('session-token', (payload: unknown) => tokens.push(payload));
    guest.on('session-token', (payload: unknown) => tokens.push(payload));
    const created = onceEvent<{ code: string }>(host, 'room-created');
    const started = Promise.all([
      onceEvent(host, 'game-start'),
      onceEvent(guest, 'game-start'),
    ]);
    host.emit('room-create', { playerId: 'player1', username: 'Player1' });
    const { code } = await created;
    guest.emit('room-join', {
      playerId: 'player2',
      username: 'Player2',
      code,
    });
    await started;
    expect(tokens).toEqual([]);
    const error = onceEvent<{ reason: string }>(host, 'match-resume-error');
    host.emit('match-resume', { token: 'nope', haveTick: 0 });
    expect((await error).reason).toBe('invalid');
  });

  it('rebinds on resume, ignores a body playerId, and does not skip or repeat a tick', async () => {
    const { server, url } = await startServer();
    const { host, guest, matchId, hostToken } = await openMatch(url);
    const oldId = host.id;
    const guestTicks: number[] = [];
    guest.on('commands-batch', (batch: { tick: number }) => {
      guestTicks.push(batch.tick);
    });
    const hostTicks: number[] = [];
    host.on('commands-batch', (batch: { tick: number }) => {
      hostTicks.push(batch.tick);
    });

    for (let tick = 0; tick < 3; tick++) {
      const batch = await playTick(guest, guest, tick, tick);
      expect(batch.tick).toBe(tick);
    }
    await waitForLength(hostTicks, 3);
    expect(hostTicks).toEqual([0, 1, 2]);

    const gone = onceEvent(guest, 'player-disconnected');
    host.disconnect();
    await gone;

    for (let tick = 3; tick < 6; tick++) {
      const batch = await playTick(guest, guest, tick, tick);
      expect(batch.tick).toBe(tick);
    }
    expect(hostTicks).toEqual([0, 1, 2]);

    const next = await connect(url);
    const order: string[] = [];
    next.on('reconnect-state', () => order.push('reconnect-state'));
    next.on('session-token', () => order.push('session-token'));
    next.on('match-resume-state', () => order.push('match-resume-state'));
    const resumed = onceEvent<MatchResumeStateEvent>(
      next,
      'match-resume-state'
    );
    next.emit('match-resume', {
      token: hostToken,
      haveTick: 2,
      playerId: 'intruder',
    });
    const state = await resumed;
    expect(order).toEqual([
      'reconnect-state',
      'session-token',
      'match-resume-state',
    ]);
    expect(state.matchId).toBe(matchId);
    expect(state.slot).toBe(0);
    expect(state.currentTick).toBe(6);
    expect(state.state).toBe('playing');
    expect('absentDeadline' in state).toBe(false);

    const room = findRoom(server, matchId);
    expect(room.isParticipantSocket(oldId)).toBe(false);
    expect(room.isParticipantSocket(next.id)).toBe(true);

    const logChunk = onceEvent<MatchLogChunkEvent>(next, 'match-log-chunk');
    next.emit('match-log', { matchId, fromTick: 3 });
    const log = await logChunk;
    expect(log.done).toBe(true);
    expect(log.entries.map((entry) => entry.tick)).toEqual([3, 4, 5]);

    const after: number[] = [];
    next.on('commands-batch', (batch: { tick: number }) => {
      after.push(batch.tick);
    });
    for (let tick = 6; tick < 9; tick++) {
      const batch = await playTick(guest, next, tick, tick);
      expect(batch.tick).toBe(tick);
    }
    expect(after).toEqual([6, 7, 8]);
    await waitForLength(guestTicks, 9);
    expect(guestTicks).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const merged = [
      ...hostTicks,
      ...log.entries.map((entry) => entry.tick),
      ...after,
    ];
    expect(merged).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(merged).size).toBe(merged.length);

    const ack = onceEvent<{ accepted: boolean; tick: number }>(
      next,
      'submit-commands-ack'
    );
    const attributed = onceEvent<{ commands: PlayerCommand[] }>(
      guest,
      'commands-batch'
    );
    next.emit('submit-commands', {
      tick: 9,
      commands: [{ type: 'move', data: { x: 1 } }],
    });
    expect(await ack).toMatchObject({ accepted: true, tick: 9 });
    const broadcast = await attributed;
    expect(broadcast.commands[0]?.playerId).toBe('player1');
  });

  it('rejects a forged token and a token for another match', async () => {
    const { server, url } = await startServer();
    const opened = await openMatch(url);
    const dot = opened.hostToken.indexOf('.');
    const payload = opened.hostToken.slice(0, dot);
    const signature = opened.hostToken.slice(dot + 1);
    const forged =
      signature[0] === 'A'
        ? `${payload}.B${signature.slice(1)}`
        : `${payload}.A${signature.slice(1)}`;
    const next = await connect(url);
    const forgedError = onceEvent<{ reason: string }>(
      next,
      'match-resume-error'
    );
    next.emit('match-resume', { token: forged, haveTick: -1 });
    expect((await forgedError).reason).toBe('invalid');
    expect(findRoom(server, opened.matchId).isParticipantSocket(next.id)).toBe(
      false
    );

    const foreign = new SessionTokens({ secret: SECRET }).issue({
      matchId: 'match-other',
      playerId: 'player1',
      slot: 0,
    });
    const foreignError = onceEvent<{ reason: string }>(
      next,
      'match-resume-error'
    );
    next.emit('match-resume', { token: foreign, haveTick: 0 });
    expect((await foreignError).reason).toBe('invalid');

    const intruder = new SessionTokens({ secret: SECRET }).issue({
      matchId: opened.matchId,
      playerId: 'intruder',
      slot: 0,
    });
    const intruderError = onceEvent<{ reason: string }>(
      next,
      'match-resume-error'
    );
    next.emit('match-resume', { token: intruder, haveTick: 0 });
    expect((await intruderError).reason).toBe('invalid');
    expect(findRoom(server, opened.matchId).isParticipantSocket(next.id)).toBe(
      false
    );
  });

  it('answers match-ended inside the tombstone window and invalid after it', async () => {
    const { server, url } = await startServer();
    server.on('player-command', (_playerId, _command, ctx) => {
      ctx.endMatch({ reason: 'forfeit' });
    });
    const { host, guest, hostToken } = await openMatch(url);
    const ended = onceEvent(host, 'match-end');
    guest.emit('submit-commands', {
      tick: 0,
      commands: [{ type: 'ping', data: { n: 1 } }],
    });
    await ended;

    const next = await connect(url);
    const first = onceEvent<{ reason: string }>(next, 'match-resume-error');
    next.emit('match-resume', { token: hostToken, haveTick: -1 });
    expect((await first).reason).toBe('match-ended');

    const endedAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(endedAt + SESSION_TOMBSTONE_TTL_MS);
    const second = onceEvent<{ reason: string }>(next, 'match-resume-error');
    next.emit('match-resume', { token: hostToken, haveTick: -1 });
    expect((await second).reason).toBe('invalid');
  });

  it('rejects an expired token before the tombstone check', async () => {
    const { url } = await startServer({
      session: { secret: SECRET, ttlMs: 40 },
    });
    const { hostToken } = await openMatch(url);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const next = await connect(url);
    const error = onceEvent<{ reason: string }>(next, 'match-resume-error');
    next.emit('match-resume', { token: hostToken, haveTick: 0 });
    expect((await error).reason).toBe('expired');
  });

  it('rejects a build mismatch and a missing build when requireBuildId is set', async () => {
    const strict = await startServer({ requireBuildId: true });
    const opened = await openMatch(strict.url, {
      host: 'build-a',
      guest: 'build-a',
    });
    const mismatch = await connect(strict.url);
    const mismatchError = onceEvent<{ reason: string }>(
      mismatch,
      'match-resume-error'
    );
    mismatch.emit('match-resume', {
      token: opened.hostToken,
      haveTick: 0,
      buildId: 'build-b',
    });
    expect((await mismatchError).reason).toBe('build-mismatch');

    const missing = onceEvent<{ reason: string }>(
      mismatch,
      'match-resume-error'
    );
    mismatch.emit('match-resume', { token: opened.hostToken, haveTick: 0 });
    expect((await missing).reason).toBe('build-mismatch');

    const ok = onceEvent<MatchResumeStateEvent>(mismatch, 'match-resume-state');
    mismatch.emit('match-resume', {
      token: opened.hostToken,
      haveTick: -1,
      buildId: 'build-a',
    });
    expect((await ok).slot).toBe(0);

    const loose = await startServer();
    const looseMatch = await openMatch(loose.url, {
      host: 'build-a',
      guest: 'build-a',
    });
    const other = await connect(loose.url);
    const looseMismatch = onceEvent<{ reason: string }>(
      other,
      'match-resume-error'
    );
    other.emit('match-resume', {
      token: looseMatch.hostToken,
      haveTick: 0,
      buildId: 'build-b',
    });
    expect((await looseMismatch).reason).toBe('build-mismatch');
    const allowed = onceEvent<MatchResumeStateEvent>(
      other,
      'match-resume-state'
    );
    other.emit('match-resume', {
      token: looseMatch.hostToken,
      haveTick: -1,
    });
    expect((await allowed).matchId).toBe(looseMatch.matchId);
  });

  it('rejects a haveTick that is not an integer >= -1', async () => {
    const { url } = await startServer();
    const { host, hostToken } = await openMatch(url);
    for (const haveTick of [-2, 1.5, '0']) {
      const error = onceEvent<{ reason: string }>(host, 'match-resume-error');
      host.emit('match-resume', { token: hostToken, haveTick });
      expect((await error).reason).toBe('invalid');
    }
  });

  it('sends session-token after reconnect-state when game-start was missed', async () => {
    const { url } = await startServer({ countdownSeconds: 1 });
    const host = await connect(url);
    const guest = await connect(url);
    let tokenBeforeDisconnect = false;
    host.on('session-token', () => {
      tokenBeforeDisconnect = true;
    });
    const created = onceEvent<{ code: string }>(host, 'room-created');
    const found = onceEvent<MatchFoundEvent>(host, 'match-found');
    const countdown = onceEvent(host, 'countdown');
    const guestStarted = onceEvent(guest, 'game-start');
    host.emit('room-create', { playerId: 'player1', username: 'Player1' });
    const { code } = await created;
    guest.emit('room-join', {
      playerId: 'player2',
      username: 'Player2',
      code,
    });
    await found;
    await countdown;
    host.disconnect();
    await guestStarted;
    expect(tokenBeforeDisconnect).toBe(false);

    const next = await connect(url);
    const order: string[] = [];
    next.on('reconnect-state', () => order.push('reconnect-state'));
    next.on('session-token', () => order.push('session-token'));
    const token = onceEvent<SessionTokenEvent>(next, 'session-token');
    next.emit('reconnect-match', {
      playerId: 'player1',
      matchId: (await found).matchId,
    });
    const issued = await token;
    expect(order).toEqual(['reconnect-state', 'session-token']);
    const verified = new SessionTokens({ secret: SECRET }).verify(
      issued.token,
      Date.now()
    );
    expect(verified.ok && verified.claims.playerId).toBe('player1');
    expect(verified.ok && verified.claims.slot).toBe(0);
  });

  it('keeps legacy reconnect when requireSessionToken is false', async () => {
    const { url } = await startServer({
      reconnect: { requireSessionToken: false },
    });
    const { host, guest, matchId } = await openMatch(url);
    const gone = onceEvent(guest, 'player-disconnected');
    host.disconnect();
    await gone;
    const next = await connect(url);
    const status = onceEvent<{ success: boolean; reason?: string }>(
      next,
      'reconnect-status'
    );
    const state = onceEvent<{ matchId: string }>(next, 'reconnect-state');
    next.emit('reconnect-match', { playerId: 'player1', matchId });
    expect(await status).toEqual({ success: true });
    expect((await state).matchId).toBe(matchId);
  });

  it('rejects legacy reconnect and in-match room-recover when requireSessionToken is set', async () => {
    const { server, url } = await startServer({
      reconnect: { requireSessionToken: true },
    });
    const waitingHost = await connect(url);
    const created = onceEvent<{ code: string }>(waitingHost, 'room-created');
    waitingHost.emit('room-create', {
      playerId: 'waiter',
      username: 'Waiter',
    });
    const waiting = await created;
    waitingHost.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const reclaimed = await connect(url);
    const recovered = onceEvent<{ code: string }>(reclaimed, 'room-recovered');
    reclaimed.emit('room-recover', {
      playerId: 'waiter',
      username: 'Waiter',
      code: waiting.code,
    });
    expect((await recovered).code).toBe(waiting.code);

    const { host, guest, matchId, code } = await openMatch(url);
    const gone = onceEvent(guest, 'player-disconnected');
    host.disconnect();
    await gone;
    const legacy = await connect(url);
    const status = onceEvent<{ success: boolean; reason?: string }>(
      legacy,
      'reconnect-status'
    );
    legacy.emit('reconnect-match', { playerId: 'player1', matchId });
    expect(await status).toEqual({
      success: false,
      reason: 'session-token-required',
    });
    expect(findRoom(server, matchId).isParticipantSocket(legacy.id)).toBe(
      false
    );

    const recover = await connect(url);
    const roomError = onceEvent<{ message: string }>(recover, 'room-error');
    recover.emit('room-recover', {
      playerId: 'player1',
      username: 'Player1',
      code,
    });
    expect((await roomError).message).toBe('session-token-required');
    expect(findRoom(server, matchId).isParticipantSocket(recover.id)).toBe(
      false
    );
  });

  it('reports absentDeadline only while another player is absent', async () => {
    const { url } = await startServer({
      absence: { windowMs: 60_000, matchBudgetMs: 60_000 },
    });
    const present = await openMatch(url);
    const presentGone = onceEvent(present.guest, 'player-disconnected');
    present.host.disconnect();
    await presentGone;
    const alone = await connect(url);
    const aloneState = onceEvent<MatchResumeStateEvent>(
      alone,
      'match-resume-state'
    );
    alone.emit('match-resume', {
      token: present.hostToken,
      haveTick: -1,
    });
    const aloneResume = await aloneState;
    expect('absentDeadline' in aloneResume).toBe(false);

    const crowded = await openMatch(url);
    const guestGone = onceEvent<{ playerId: string }>(
      crowded.host,
      'player-disconnected'
    );
    crowded.guest.disconnect();
    await guestGone;
    crowded.host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const returned = await connect(url);
    const returnedState = onceEvent<MatchResumeStateEvent>(
      returned,
      'match-resume-state'
    );
    returned.emit('match-resume', {
      token: crowded.hostToken,
      haveTick: -1,
    });
    const withAbsence = await returnedState;
    expect(withAbsence.absentDeadline).toEqual(expect.any(Number));
    expect(withAbsence.absentDeadline).toBeGreaterThan(0);
    expect(withAbsence.absentDeadline).toBeLessThanOrEqual(60_000);
  });
});
