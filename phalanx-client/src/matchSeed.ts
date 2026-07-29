import type { GameStartEvent } from './types.js';

/**
 * Derive a deterministic 32-bit seed from a match id when the server omits
 * `randomSeed` (wire backward compatibility). Every peer hashing the same
 * match id gets the same seed.
 */
export function deriveMatchRandomSeed(matchId: string): number {
  let hash = 0;
  for (let i = 0; i < matchId.length; i++) {
    hash = (Math.imul(31, hash) + matchId.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Resolve the lockstep RNG seed from a game-start event.
 */
export function resolveMatchRandomSeed(event: GameStartEvent): number {
  if (typeof event.randomSeed === 'number') {
    return event.randomSeed >>> 0;
  }

  console.warn(
    '[PhalanxClient] No randomSeed in game-start event; deriving seed from matchId'
  );
  return deriveMatchRandomSeed(event.matchId);
}
