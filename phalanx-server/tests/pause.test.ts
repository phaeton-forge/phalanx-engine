import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io, Socket } from 'socket.io-client';
import { Phalanx } from '../src/Phalanx.js';
import type { MatchFoundEvent, PauseConfig } from '../src/types/index.js';

/**
 * Tests for Game Pause Functionality
 * Tests both pause rules:
 * 1. maxPausesPerPlayer - limits how many times each player can pause
 * 2. requireSamePlayerToResume - whether only the pauser can resume
 */
describe('Game Pause Functionality', () => {
  let server: Phalanx;
  let clients: Socket[] = [];
  const TEST_PORT = 3350;

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

  async function setupTwoPlayerMatch(
    pauseConfig?: Partial<PauseConfig>
  ): Promise<{ client1: Socket; client2: Socket; matchId: string }> {
    server = new Phalanx({
      port: TEST_PORT,
      playersPerTeam: 1,
      teamsPerMatch: 2,
      countdownSeconds: 0,
      pause: pauseConfig,
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

    // Wait for game-start events
    const gameStartPromise1 = new Promise<void>((resolve) => {
      client1.on('game-start', () => resolve());
    });
    const gameStartPromise2 = new Promise<void>((resolve) => {
      client2.on('game-start', () => resolve());
    });

    client1.emit('queue-join', { playerId: 'player1', username: 'alice' });
    client2.emit('queue-join', { playerId: 'player2', username: 'bob' });

    const [matchFound1] = await Promise.all([matchPromise1, matchPromise2]);

    // Wait for game to start
    await Promise.all([gameStartPromise1, gameStartPromise2]);

    return { client1, client2, matchId: matchFound1.matchId };
  }

  describe('Basic Pause/Resume', () => {
    beforeEach(() => {
      clients = [];
    });

    afterEach(async () => {
      await cleanupServer();
    });

    it('should allow player to pause the game', async () => {
      const { client1 } = await setupTwoPlayerMatch();

      const pausePromise = new Promise<{ requestedBy: string; lastTick: number }>((resolve) => {
        client1.on('game-paused', (data) => resolve(data));
      });

      client1.emit('pause-game');

      const pauseEvent = await pausePromise;
      expect(pauseEvent.requestedBy).toBe('player1');
      expect(typeof pauseEvent.lastTick).toBe('number');
    });

    it('should broadcast pause event to all clients', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch();

      const pausePromise1 = new Promise<{ requestedBy: string }>((resolve) => {
        client1.on('game-paused', (data) => resolve(data));
      });
      const pausePromise2 = new Promise<{ requestedBy: string }>((resolve) => {
        client2.on('game-paused', (data) => resolve(data));
      });

      client1.emit('pause-game');

      const [pause1, pause2] = await Promise.all([pausePromise1, pausePromise2]);
      expect(pause1.requestedBy).toBe('player1');
      expect(pause2.requestedBy).toBe('player1');
    });

    it('should allow player to resume the game after pause', async () => {
      const { client1 } = await setupTwoPlayerMatch();

      // Pause first
      const pausePromise = new Promise<void>((resolve) => {
        client1.on('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pausePromise;

      // Then resume
      const resumePromise = new Promise<{ requestedBy: string }>((resolve) => {
        client1.on('game-resumed', (data) => resolve(data));
      });
      client1.emit('resume-game');

      const resumeEvent = await resumePromise;
      expect(resumeEvent.requestedBy).toBe('player1');
    });

    it('should broadcast resume event to all clients', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch();

      // Pause first
      const pausePromise = new Promise<void>((resolve) => {
        client1.on('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pausePromise;

      // Then resume
      const resumePromise1 = new Promise<{ requestedBy: string }>((resolve) => {
        client1.on('game-resumed', (data) => resolve(data));
      });
      const resumePromise2 = new Promise<{ requestedBy: string }>((resolve) => {
        client2.on('game-resumed', (data) => resolve(data));
      });

      client2.emit('resume-game');

      const [resume1, resume2] = await Promise.all([resumePromise1, resumePromise2]);
      expect(resume1.requestedBy).toBe('player2');
      expect(resume2.requestedBy).toBe('player2');
    });

    it('should not resume when game is not paused', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch();

      // Attempt to resume without pausing first - should fail silently
      const resumeReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 200);
        client1.on('game-resumed', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      client2.emit('resume-game');

      const didReceiveResume = await resumeReceived;
      expect(didReceiveResume).toBe(false);
    });

    it('should not pause when game is already paused', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch();

      // First pause
      const pausePromise1 = new Promise<{ requestedBy: string }>((resolve) => {
        client1.once('game-paused', (data) => resolve(data));
      });
      client1.emit('pause-game');
      await pausePromise1;

      // Second pause attempt - should fail silently
      const secondPauseReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 200);
        client1.once('game-paused', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      client2.emit('pause-game');

      const didReceiveSecondPause = await secondPauseReceived;
      expect(didReceiveSecondPause).toBe(false);
    });
  });

  describe('maxPausesPerPlayer Rule', () => {
    beforeEach(() => {
      clients = [];
    });

    afterEach(async () => {
      await cleanupServer();
    });

    it('should enforce maxPausesPerPlayer limit', async () => {
      const { client1 } = await setupTwoPlayerMatch({
        maxPausesPerPlayer: 2,
      });

      // First pause - should succeed
      const pause1Promise = new Promise<void>((resolve) => {
        client1.once('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pause1Promise;

      // Resume
      const resume1Promise = new Promise<void>((resolve) => {
        client1.once('game-resumed', () => resolve());
      });
      client1.emit('resume-game');
      await resume1Promise;

      // Second pause - should succeed
      const pause2Promise = new Promise<void>((resolve) => {
        client1.once('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pause2Promise;

      // Resume
      const resume2Promise = new Promise<void>((resolve) => {
        client1.once('game-resumed', () => resolve());
      });
      client1.emit('resume-game');
      await resume2Promise;

      // Third pause - should fail silently (limit is 2)
      const thirdPauseReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 200);
        client1.once('game-paused', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });

      client1.emit('pause-game');

      const didReceiveThirdPause = await thirdPauseReceived;
      expect(didReceiveThirdPause).toBe(false);
    });

    it('should track pause count per player independently', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch({
        maxPausesPerPlayer: 1,
      });

      // Player 1 pauses
      const pause1Promise = new Promise<void>((resolve) => {
        client1.once('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pause1Promise;

      // Player 2 resumes
      const resume1Promise = new Promise<void>((resolve) => {
        client1.once('game-resumed', () => resolve());
      });
      client2.emit('resume-game');
      await resume1Promise;

      // Player 1 tries to pause again - should fail (used up their 1 pause)
      const player1SecondPause = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 200);
        client1.once('game-paused', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      client1.emit('pause-game');
      const didPlayer1Pause = await player1SecondPause;
      expect(didPlayer1Pause).toBe(false);

      // Player 2 can still pause (hasn't used their pause)
      const pause2Promise = new Promise<{ requestedBy: string }>((resolve) => {
        client1.once('game-paused', (data) => resolve(data));
      });
      client2.emit('pause-game');
      const pause2Event = await pause2Promise;
      expect(pause2Event.requestedBy).toBe('player2');
    });

    it('should allow infinite pauses when maxPausesPerPlayer is Infinity', async () => {
      const { client1 } = await setupTwoPlayerMatch({
        maxPausesPerPlayer: Infinity,
      });

      // Perform multiple pause/resume cycles
      for (let i = 0; i < 5; i++) {
        const pausePromise = new Promise<void>((resolve) => {
          client1.once('game-paused', () => resolve());
        });
        client1.emit('pause-game');
        await pausePromise;

        const resumePromise = new Promise<void>((resolve) => {
          client1.once('game-resumed', () => resolve());
        });
        client1.emit('resume-game');
        await resumePromise;
      }

      // All 5 cycles completed - test passes
      expect(true).toBe(true);
    });
  });

  describe('requireSamePlayerToResume Rule', () => {
    beforeEach(() => {
      clients = [];
    });

    afterEach(async () => {
      await cleanupServer();
    });

    it('should allow any player to resume when requireSamePlayerToResume is false', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch({
        requireSamePlayerToResume: false,
      });

      // Player 1 pauses
      const pausePromise = new Promise<void>((resolve) => {
        client1.on('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pausePromise;

      // Player 2 resumes - should work
      const resumePromise = new Promise<{ requestedBy: string }>((resolve) => {
        client1.on('game-resumed', (data) => resolve(data));
      });
      client2.emit('resume-game');

      const resumeEvent = await resumePromise;
      expect(resumeEvent.requestedBy).toBe('player2');
    });

    it('should only allow pauser to resume when requireSamePlayerToResume is true', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch({
        requireSamePlayerToResume: true,
      });

      // Player 1 pauses
      const pausePromise = new Promise<void>((resolve) => {
        client1.on('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pausePromise;

      // Player 2 tries to resume - should fail silently
      const player2ResumeReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 200);
        client1.on('game-resumed', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      client2.emit('resume-game');
      const didPlayer2Resume = await player2ResumeReceived;
      expect(didPlayer2Resume).toBe(false);

      // Player 1 resumes - should work
      const resumePromise = new Promise<{ requestedBy: string }>((resolve) => {
        client1.on('game-resumed', (data) => resolve(data));
      });
      client1.emit('resume-game');

      const resumeEvent = await resumePromise;
      expect(resumeEvent.requestedBy).toBe('player1');
    });

    it('should track pauser correctly across multiple pauses', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch({
        requireSamePlayerToResume: true,
        maxPausesPerPlayer: 5,
      });

      // Player 1 pauses
      const pause1Promise = new Promise<void>((resolve) => {
        client1.once('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pause1Promise;

      // Player 1 resumes
      const resume1Promise = new Promise<void>((resolve) => {
        client1.once('game-resumed', () => resolve());
      });
      client1.emit('resume-game');
      await resume1Promise;

      // Player 2 pauses
      const pause2Promise = new Promise<void>((resolve) => {
        client1.once('game-paused', () => resolve());
      });
      client2.emit('pause-game');
      await pause2Promise;

      // Player 1 tries to resume - should fail (Player 2 paused)
      const player1ResumeReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 200);
        client1.once('game-resumed', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      client1.emit('resume-game');
      const didPlayer1Resume = await player1ResumeReceived;
      expect(didPlayer1Resume).toBe(false);

      // Player 2 resumes - should work
      const resume2Promise = new Promise<{ requestedBy: string }>((resolve) => {
        client1.once('game-resumed', (data) => resolve(data));
      });
      client2.emit('resume-game');

      const resume2Event = await resume2Promise;
      expect(resume2Event.requestedBy).toBe('player2');
    });
  });

  describe('Combined Pause Rules', () => {
    beforeEach(() => {
      clients = [];
    });

    afterEach(async () => {
      await cleanupServer();
    });

    it('should enforce both maxPausesPerPlayer and requireSamePlayerToResume', async () => {
      const { client1, client2 } = await setupTwoPlayerMatch({
        maxPausesPerPlayer: 1,
        requireSamePlayerToResume: true,
      });

      // Player 1 pauses (uses their only pause)
      const pause1Promise = new Promise<void>((resolve) => {
        client1.once('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pause1Promise;

      // Player 2 cannot resume (requireSamePlayerToResume)
      const player2ResumeReceived = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 200);
        client1.once('game-resumed', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      client2.emit('resume-game');
      const didPlayer2Resume = await player2ResumeReceived;
      expect(didPlayer2Resume).toBe(false);

      // Player 1 resumes
      const resume1Promise = new Promise<void>((resolve) => {
        client1.once('game-resumed', () => resolve());
      });
      client1.emit('resume-game');
      await resume1Promise;

      // Player 1 cannot pause again (maxPausesPerPlayer = 1)
      const player1SecondPause = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 200);
        client1.once('game-paused', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      client1.emit('pause-game');
      const didPlayer1Pause = await player1SecondPause;
      expect(didPlayer1Pause).toBe(false);

      // Player 2 can still pause
      const pause2Promise = new Promise<{ requestedBy: string }>((resolve) => {
        client1.once('game-paused', (data) => resolve(data));
      });
      client2.emit('pause-game');
      const pause2Event = await pause2Promise;
      expect(pause2Event.requestedBy).toBe('player2');
    });

    it('should use default values when pause config is not provided', async () => {
      // No pause config provided - defaults: maxPausesPerPlayer=Infinity, requireSamePlayerToResume=false
      const { client1, client2 } = await setupTwoPlayerMatch();

      // Player 1 pauses
      const pausePromise = new Promise<void>((resolve) => {
        client1.on('game-paused', () => resolve());
      });
      client1.emit('pause-game');
      await pausePromise;

      // Player 2 can resume (default: requireSamePlayerToResume = false)
      const resumePromise = new Promise<{ requestedBy: string }>((resolve) => {
        client1.on('game-resumed', (data) => resolve(data));
      });
      client2.emit('resume-game');

      const resumeEvent = await resumePromise;
      expect(resumeEvent.requestedBy).toBe('player2');
    });
  });
});







