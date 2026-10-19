import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type { QueueStatusEvent } from '../src/types/index.js';

/**
 * Tests for Story 1 (MATCH-1): Player Can Join the Matchmaking Queue
 */
describe('MATCH-1: Player Can Join the Matchmaking Queue', () => {
  let server: Phalanx;
  let clients: Socket[] = [];

  beforeEach(async () => {
    server = new Phalanx({ port: 0 });
    await server.start();
    clients = [];
  });

  afterEach(async () => {
    // Disconnect all clients first
    for (const client of clients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    clients = [];
    // Small delay to allow disconnect events to process
    await new Promise((resolve) => setTimeout(resolve, 50));
    await server.stop();
  });

  function createClient(): Socket {
    const client = io(`http://localhost:${String(server.getPort())}`, {
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

  it('should respond with queue-status when player sends queue-join', async () => {
    const client = createClient();
    await connectClient(client);

    const statusPromise = new Promise<QueueStatusEvent>((resolve) => {
      client.on('queue-status', (data: QueueStatusEvent) => resolve(data));
    });

    client.emit('queue-join', { playerId: 'player1', username: 'alice' });

    const status = await statusPromise;
    expect(status.position).toBe(1);
    expect(status.waitTime).toBeGreaterThanOrEqual(1000);
  });

  it('should show accurate queue position (1-indexed)', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    // First player joins
    const status1Promise = new Promise<QueueStatusEvent>((resolve) => {
      client1.on('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    const status1 = await status1Promise;
    expect(status1.position).toBe(1);

    // Second player joins
    const status2Promise = new Promise<QueueStatusEvent>((resolve) => {
      client2.on('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });
    const status2 = await status2Promise;
    expect(status2.position).toBe(2);
  });

  it('should prevent duplicate queue joins (player can not join twice)', async () => {
    const client = createClient();
    await connectClient(client);

    // First join
    const status1Promise = new Promise<QueueStatusEvent>((resolve) => {
      client.once('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client.emit('queue-join', { playerId: 'player1', username: 'alice' });
    const status1 = await status1Promise;
    expect(status1.position).toBe(1);

    // Second join attempt (same player)
    const errorPromise = new Promise<{ message: string }>((resolve) => {
      client.once('error', (data: { message: string }) => resolve(data));
    });
    client.emit('queue-join', { playerId: 'player1', username: 'alice' });
    const error = await errorPromise;
    expect(error.message).toBe('Already in queue');
  });

  it('should calculate estimated wait time (minimum 1 second)', async () => {
    const client = createClient();
    await connectClient(client);

    const statusPromise = new Promise<QueueStatusEvent>((resolve) => {
      client.on('queue-status', (data: QueueStatusEvent) => resolve(data));
    });

    client.emit('queue-join', { playerId: 'player1', username: 'alice' });

    const status = await statusPromise;
    expect(status.waitTime).toBeGreaterThanOrEqual(1000);
  });

  it('should update queue size when player is added', async () => {
    const client1 = createClient();
    const client2 = createClient();
    await connectClient(client1);
    await connectClient(client2);

    // Initially queue is empty
    expect(server.getQueueSize()).toBe(0);

    // First player joins
    const status1Promise = new Promise<QueueStatusEvent>((resolve) => {
      client1.on('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    await status1Promise;
    expect(server.getQueueSize()).toBe(1);

    // Second player joins
    const status2Promise = new Promise<QueueStatusEvent>((resolve) => {
      client2.on('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });
    await status2Promise;
    expect(server.getQueueSize()).toBe(2);
  });

  it('should use playerId as username fallback when username is not provided', async () => {
    const client = createClient();
    await connectClient(client);

    const statusPromise = new Promise<QueueStatusEvent>((resolve) => {
      client.on('queue-status', (data: QueueStatusEvent) => resolve(data));
    });

    // Emit without username
    client.emit('queue-join', { playerId: 'player123' });

    const status = await statusPromise;
    expect(status.position).toBe(1);
  });
});
