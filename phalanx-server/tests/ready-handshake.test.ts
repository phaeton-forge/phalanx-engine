import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type { MatchFoundEvent } from '../src/types/index.js';

/**
 * Tests for the client-ready handshake protocol.
 * Ensures the server waits for all clients to report ready before starting
 * the tick loop, preventing desync from asymmetric asset loading times.
 */
describe('Ready Handshake Protocol', () => {
  let server: Phalanx;
  let clients: Socket[] = [];
  const TEST_PORT = 3360;

  function createClient(): Socket {
    const client = io(`http://localhost:${TEST_PORT}`, {
      autoConnect: false,
      forceNew: true,
    });
    clients.push(client);
    return client;
  }

  async function connectClient(client: Socket): Promise<void> {
    return new Promise((resolve) => {
      client.on('connect', () => resolve());
      client.connect();
    });
  }

  async function cleanupServer(): Promise<void> {
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients = [];
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (server) {
      await server.stop();
    }
  }

  /**
   * Set up a two-player match that reaches the game-start event
   * but does NOT send client-ready (so the tick loop should not start).
   */
  async function setupTwoPlayerMatch(): Promise<{
    client1: Socket;
    client2: Socket;
    matchId: string;
  }>;
  async function setupTwoPlayerMatch(options: {
    tickMode?: 'continuous' | 'event';
  }): Promise<{
    client1: Socket;
    client2: Socket;
    matchId: string;
  }>;
  async function setupTwoPlayerMatch(
    options: { tickMode?: 'continuous' | 'event' } = {}
  ): Promise<{
    client1: Socket;
    client2: Socket;
    matchId: string;
  }> {
    server = new Phalanx({
      port: TEST_PORT,
      countdownSeconds: 0,
      ...(options.tickMode ? { tickMode: options.tickMode } : {}),
    });
    await server.start();

    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    const matchPromise1 = new Promise<MatchFoundEvent>((resolve) => {
      client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });
    const matchPromise2 = new Promise<MatchFoundEvent>((resolve) => {
      client2.on('match-found', (data: MatchFoundEvent) => resolve(data));
    });

    // Wait for game-start events (server enters waiting-for-ready)
    const gameStartPromise1 = new Promise<void>((resolve) => {
      client1.on('game-start', () => resolve());
    });
    const gameStartPromise2 = new Promise<void>((resolve) => {
      client2.on('game-start', () => resolve());
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const [matchFound1] = await Promise.all([matchPromise1, matchPromise2]);
    await Promise.all([gameStartPromise1, gameStartPromise2]);

    return { client1, client2, matchId: matchFound1.matchId };
  }

  describe('Basic Ready Handshake', () => {
    beforeEach(() => {
      clients = [];
    });

    afterEach(async () => {
      await cleanupServer();
    });

    it('should NOT start tick loop until all clients send client-ready', async () => {
      const { client1 } = await setupTwoPlayerMatch();

      // Listen for tick-sync events (indicates tick loop has started)
      const tickReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 500);
        client1.on('tick-sync', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      // Do NOT send client-ready — tick loop should not start
      const didReceiveTick = await tickReceived;
      expect(didReceiveTick).toBe(false);
    });

    it('should start tick loop after all clients send client-ready', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch();

      // Listen for tick-sync events
      const tickPromise = new Promise<{ tick: number }>((resolve) => {
        client1.on('tick-sync', (data: { tick: number }) => resolve(data));
      });

      // Both clients report ready
      client1.emit('client-ready');
      client2.emit('client-ready');

      const tickData = await tickPromise;
      expect(tickData.tick).toBe(0);
    });

    it('should NOT start tick loop if only one client reports ready', async () => {
      const { client1 } = await setupTwoPlayerMatch();

      // Only client1 reports ready
      client1.emit('client-ready');

      // Listen for tick-sync
      const tickReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 500);
        client1.on('tick-sync', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      const didReceiveTick = await tickReceived;
      expect(didReceiveTick).toBe(false);
    });

    it('should broadcast player-ready event to all clients when a player reports ready', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch();

      const readyPromise = new Promise<{ playerId: string }>((resolve) => {
        client2.on('player-ready', (data: { playerId: string }) => resolve(data));
      });

      client1.emit('client-ready');

      const readyEvent = await readyPromise;
      expect(readyEvent.playerId).toBe('player1');
    });
  });

  describe('Ready Timeout', () => {
    beforeEach(() => {
      clients = [];
    });

    afterEach(async () => {
      await cleanupServer();
    });

    it('should end match with ready-timeout if not all clients report ready in time', async () => {
      // Use a very short timeout for testing
      server = new Phalanx({
        port: TEST_PORT,
        countdownSeconds: 0,
        readyTimeoutMs: 200,
      });
      await server.start();

      const client1 = createClient();
      const client2 = createClient();
      await connectClient(client1);
      await connectClient(client2);

      const matchPromise1 = new Promise<MatchFoundEvent>((resolve) => {
        client1.on('match-found', (data: MatchFoundEvent) => resolve(data));
      });
      const matchPromise2 = new Promise<MatchFoundEvent>((resolve) => {
        client2.on('match-found', (data: MatchFoundEvent) => resolve(data));
      });

      const gameStartPromise1 = new Promise<void>((resolve) => {
        client1.on('game-start', () => resolve());
      });
      const gameStartPromise2 = new Promise<void>((resolve) => {
        client2.on('game-start', () => resolve());
      });

      client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
      client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

      await Promise.all([matchPromise1, matchPromise2]);
      await Promise.all([gameStartPromise1, gameStartPromise2]);

      // Listen for match-end with ready-timeout reason
      const matchEndPromise = new Promise<{ reason: string }>((resolve) => {
        client1.on('match-end', (data: { reason: string }) => resolve(data));
      });

      // Only client1 reports ready; client2 does not.
      client1.emit('client-ready');
      // Don't send client2 ready — wait for timeout

      const matchEnd = await matchEndPromise;
      expect(matchEnd.reason).toBe('ready-timeout');
    });
  });

  describe('Disconnect During Waiting-for-Ready', () => {
    beforeEach(() => {
      clients = [];
    });

    afterEach(async () => {
      await cleanupServer();
    });

    it('should NOT start game if a waiting-for-ready player disconnects', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch();

      // Client1 reports ready
      client1.emit('client-ready');

      const tickReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 300);
        client1.on('tick-sync', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      // Client2 disconnects instead of reporting ready
      client2.disconnect();

      const didReceiveTick = await tickReceived;
      expect(didReceiveTick).toBe(false);
    });

    it('should wait for a reconnecting waiting-for-ready player to re-send ready', async () => {
      const { client1, client2, matchId } = await setupTwoPlayerMatch();

      client1.emit('client-ready');
      client2.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const recoveredClient2 = createClient();
      await connectClient(recoveredClient2);

      const reconnectStatePromise = new Promise<{ state: string }>((resolve) => {
        recoveredClient2.on('reconnect-state', (data: { state: string }) =>
          resolve(data)
        );
      });
      recoveredClient2.emit('reconnect-match', {
        playerId: 'player2',
        matchId,
      });

      const reconnectState = await reconnectStatePromise;
      expect(reconnectState.state).toBe('waiting-for-ready');

      const prematureTickReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 300);
        client1.on('tick-sync', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      expect(await prematureTickReceived).toBe(false);

      const tickPromise = new Promise<{ tick: number }>((resolve) => {
        client1.on('tick-sync', (data: { tick: number }) => resolve(data));
      });

      recoveredClient2.emit('client-ready');

      const tickData = await tickPromise;
      expect(tickData.tick).toBe(0);
    });
  });

  describe('Event Mode Ready Gate', () => {
    beforeEach(() => {
      clients = [];
    });

    afterEach(async () => {
      await cleanupServer();
    });

    it('should reject event-mode commands until every player is connected and ready', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch({
        tickMode: 'event',
      });

      client1.emit('client-ready');

      const rejectedAckPromise = new Promise<{ accepted: boolean }>((resolve) => {
        client1.once('submit-commands-ack', (data: { accepted: boolean }) =>
          resolve(data)
        );
      });
      client1.emit('submit-commands', {
        tick: 0,
        commands: [{ type: 'select', data: { entityId: 1 } }],
      });
      expect((await rejectedAckPromise).accepted).toBe(false);

      const commandsBatchPromise = new Promise<{
        tick: number;
        commands: { type: string }[];
      }>((resolve) => {
        client2.once(
          'commands-batch',
          (data: { tick: number; commands: { type: string }[] }) =>
            resolve(data)
        );
      });
      const acceptedAckPromise = new Promise<{ accepted: boolean }>((resolve) => {
        client1.once('submit-commands-ack', (data: { accepted: boolean }) =>
          resolve(data)
        );
      });

      client2.emit('client-ready');
      client1.emit('submit-commands', {
        tick: 0,
        commands: [{ type: 'select', data: { entityId: 1 } }],
      });

      expect((await acceptedAckPromise).accepted).toBe(true);
      const commandsBatch = await commandsBatchPromise;
      expect(commandsBatch.tick).toBe(0);
      expect(commandsBatch.commands[0]?.type).toBe('select');
    });
  });

  describe('Duplicate and Invalid Ready', () => {
    beforeEach(() => {
      clients = [];
    });

    afterEach(async () => {
      await cleanupServer();
    });

    it('should handle duplicate client-ready from same player gracefully', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch();

      // Listen for tick-sync
      const tickPromise = new Promise<{ tick: number }>((resolve) => {
        client1.on('tick-sync', (data: { tick: number }) => resolve(data));
      });

      // Client1 sends ready twice
      client1.emit('client-ready');
      client1.emit('client-ready');

      // Client2 sends ready
      client2.emit('client-ready');

      const tickData = await tickPromise;
      expect(tickData.tick).toBe(0);
    });

    it('should ignore client-ready when game is already playing', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch();

      // Both clients report ready
      const tickPromise = new Promise<void>((resolve) => {
        client1.on('tick-sync', () => resolve());
      });

      client1.emit('client-ready');
      client2.emit('client-ready');
      await tickPromise;

      // Game is now playing - sending client-ready again should be harmless
      // Just verify no errors
      client1.emit('client-ready');
      client2.emit('client-ready');

      // Wait briefly to ensure no errors
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  });
});
