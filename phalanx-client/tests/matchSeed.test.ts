import { describe, it, expect, vi } from 'vitest';
import { DeterministicRandom } from '../src/DeterministicRandom.js';
import { PhalanxClient } from '../src/PhalanxClient.js';
import {
  deriveMatchRandomSeed,
  resolveMatchRandomSeed,
} from '../src/matchSeed.js';
import type { GameStartEvent } from '../src/types.js';

type HandleGameStart = (event: GameStartEvent) => void;

function invokeGameStart(client: PhalanxClient, event: GameStartEvent): void {
  (client as unknown as { handleGameStart: HandleGameStart }).handleGameStart(
    event
  );
}

describe('matchSeed', () => {
  it('deriveMatchRandomSeed is stable for the same match id', () => {
    expect(deriveMatchRandomSeed('match-abc')).toBe(
      deriveMatchRandomSeed('match-abc')
    );
  });

  it('resolveMatchRandomSeed prefers event.randomSeed', () => {
    const event: GameStartEvent = {
      matchId: 'match-1',
      randomSeed: 4242,
    };
    expect(resolveMatchRandomSeed(event)).toBe(4242);
  });

  it('resolveMatchRandomSeed falls back to match id hash', () => {
    const event: GameStartEvent = { matchId: 'match-fallback' };
    expect(resolveMatchRandomSeed(event)).toBe(
      deriveMatchRandomSeed('match-fallback')
    );
  });
});

describe('PhalanxClient match RNG', () => {
  it('initializes random on game start', () => {
    const client = new PhalanxClient({
      serverUrl: 'http://localhost:9999',
      playerId: 'rng-test-player',
      username: 'RngTest',
    });

    const event: GameStartEvent = { matchId: 'match-rng', randomSeed: 9001 };
    invokeGameStart(client, event);

    expect(client.randomSeed).toBe(9001);
    expect(client.random.intRange(1, 100)).toBe(
      new DeterministicRandom(9001).intRange(1, 100)
    );

    client.disconnect();
  });

  it('derives the same fallback seed for two clients with the same match id', () => {
    const event: GameStartEvent = { matchId: 'match-shared-fallback' };

    const clientA = new PhalanxClient({
      serverUrl: 'http://localhost:9999',
      playerId: 'rng-peer-a',
      username: 'PeerA',
    });
    const clientB = new PhalanxClient({
      serverUrl: 'http://localhost:9999',
      playerId: 'rng-peer-b',
      username: 'PeerB',
    });

    invokeGameStart(clientA, event);
    invokeGameStart(clientB, event);

    expect(clientA.randomSeed).toBe(clientB.randomSeed);
    expect(clientA.random.intRange(1, 100)).toBe(
      clientB.random.intRange(1, 100)
    );

    clientA.disconnect();
    clientB.disconnect();
  });

  it('is idempotent when game start is handled twice for the same match', () => {
    const client = new PhalanxClient({
      serverUrl: 'http://localhost:9999',
      playerId: 'rng-idempotent',
      username: 'Idempotent',
    });

    const handler = vi.fn();
    client.on('gameStart', handler);

    const event: GameStartEvent = { matchId: 'match-once', randomSeed: 1234 };
    const reference = new DeterministicRandom(1234);
    const expectedFirst = reference.intRange(1, 100);
    const expectedSecond = reference.intRange(1, 100);

    invokeGameStart(client, event);
    expect(client.random.intRange(1, 100)).toBe(expectedFirst);

    invokeGameStart(client, event);
    expect(client.random.intRange(1, 100)).toBe(expectedSecond);
    expect(handler).toHaveBeenCalledTimes(1);

    client.disconnect();
  });

  it('throws when random is accessed before game start', () => {
    const client = new PhalanxClient({
      serverUrl: 'http://localhost:9999',
      playerId: 'rng-test-player-2',
      username: 'RngTest2',
    });

    expect(() => client.random).toThrow(/RNG unavailable until game start/);
    client.disconnect();
  });
});
