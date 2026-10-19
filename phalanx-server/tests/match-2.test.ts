import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type { QueueStatusEvent } from '../src/types/index.js';

/**
 * Tests for Story 2 (MATCH-2): Player Can Leave the Matchmaking Queue
 */
describe('MATCH-2: Player Can Leave the Matchmaking Queue', () => {
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

  it('should listen to queue-leave event and remove player from queue', async () => {
    const client = createClient();
    await connectClient(client);

    // Join queue first
    const statusPromise = new Promise<QueueStatusEvent>((resolve) => {
      client.once('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client.emit('queue-join', { playerId: 'player1', username: 'alice' });
    await statusPromise;
    expect(server.getQueueSize()).toBe(1);

    // Leave queue
    const leftPromise = new Promise<void>((resolve) => {
      client.once('queue-left', () => resolve());
    });
    client.emit('queue-leave');
    await leftPromise;

    expect(server.getQueueSize()).toBe(0);
  });

  it('should respond with queue-left when player leaves queue', async () => {
    const client = createClient();
    await connectClient(client);

    // Join queue first
    const statusPromise = new Promise<QueueStatusEvent>((resolve) => {
      client.once('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client.emit('queue-join', { playerId: 'player1', username: 'alice' });
    await statusPromise;

    // Leave queue and verify queue-left event
    const leftPromise = new Promise<void>((resolve) => {
      client.once('queue-left', () => resolve());
    });
    client.emit('queue-leave');

    // Should receive queue-left event
    await leftPromise;
  });

  it('should do nothing (no error) when leaving queue while not in queue', async () => {
    const client = createClient();
    await connectClient(client);

    // Attempt to leave without joining first
    let errorReceived = false;
    client.once('error', () => {
      errorReceived = true;
    });

    client.emit('queue-leave');

    // Wait a bit to ensure no error is emitted
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(errorReceived).toBe(false);
    expect(server.getQueueSize()).toBe(0);
  });

  it('should automatically remove player from queue on disconnect', async () => {
    const client = createClient();
    await connectClient(client);

    // Join queue
    const statusPromise = new Promise<QueueStatusEvent>((resolve) => {
      client.once('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client.emit('queue-join', { playerId: 'player1', username: 'alice' });
    await statusPromise;
    expect(server.getQueueSize()).toBe(1);

    // Disconnect client
    client.disconnect();

    // Wait for disconnect to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.getQueueSize()).toBe(0);
  });

  it('should update queue correctly when one of multiple players leaves', async () => {
    const client1 = createClient();
    const client2 = createClient();
    const client3 = createClient();
    await connectClient(client1);
    await connectClient(client2);
    await connectClient(client3);

    // All players join queue
    const status1Promise = new Promise<QueueStatusEvent>((resolve) => {
      client1.once('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    await status1Promise;

    const status2Promise = new Promise<QueueStatusEvent>((resolve) => {
      client2.once('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });
    await status2Promise;

    const status3Promise = new Promise<QueueStatusEvent>((resolve) => {
      client3.once('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client3.emit('queue-join', { playerId: 'player3', username: 'charlie' });
    await status3Promise;

    expect(server.getQueueSize()).toBe(3);

    // Player 2 leaves
    const leftPromise = new Promise<void>((resolve) => {
      client2.once('queue-left', () => resolve());
    });
    client2.emit('queue-leave');
    await leftPromise;

    expect(server.getQueueSize()).toBe(2);
  });

  it('should handle multiple leave attempts gracefully', async () => {
    const client = createClient();
    await connectClient(client);

    // Join queue
    const statusPromise = new Promise<QueueStatusEvent>((resolve) => {
      client.once('queue-status', (data: QueueStatusEvent) => resolve(data));
    });
    client.emit('queue-join', { playerId: 'player1', username: 'alice' });
    await statusPromise;

    // First leave
    const leftPromise = new Promise<void>((resolve) => {
      client.once('queue-left', () => resolve());
    });
    client.emit('queue-leave');
    await leftPromise;

    // Second leave attempt - should not error
    let errorReceived = false;
    client.once('error', () => {
      errorReceived = true;
    });

    client.emit('queue-leave');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(errorReceived).toBe(false);
    expect(server.getQueueSize()).toBe(0);
  });
});
