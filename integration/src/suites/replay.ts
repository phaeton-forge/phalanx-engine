import type { SimDriver } from '../driver/SimDriver.js';
import { canonicalDigest } from '../oracle/digest.js';
import { prng } from '../util/prng.js';
import { demoSpec } from './spec.js';

/** Replay runners do not host bot policies, so bot notes are not compared. */
function worldDigest(peer: {
  stateDump(): Parameters<typeof canonicalDigest>[0];
}): string {
  return canonicalDigest({ ...peer.stateDump(), bots: {} });
}

/** `toReplay` then `fastForward` matches the live run tick for tick. */
export async function runReplay(driver: SimDriver): Promise<void> {
  if (!driver.capabilities.replayPlayer) {
    throw new Error('skip: needs capabilities.replayPlayer');
  }
  const match = driver.createMatch(demoSpec(17));
  const digests: string[] = [];
  let replay;
  try {
    const peer = match.createPeer('A', { role: 'authority' });
    const rng = prng(17);
    for (let clock = 0; clock < 300; clock += 1) {
      if (rng.int(3) === 0) peer.submit({ type: 'move', dir: rng.int(4) }, 0);
      peer.step(1);
      digests.push(worldDigest(peer));
    }
    replay = peer.toReplay();
  } finally {
    match.dispose();
  }
  const replayPeer = driver.openReplay(replay);
  try {
    let cursor = -1;
    for (const digest of digests) {
      cursor += 1;
      const slice = replay.log.filter((entry) => entry.tick === cursor);
      await replayPeer.fastForward(slice, cursor);
      if (worldDigest(replayPeer) !== digest) {
        throw new Error(`replay diverged at tick ${String(cursor)}`);
      }
    }
  } finally {
    replayPeer.dispose();
  }
}
