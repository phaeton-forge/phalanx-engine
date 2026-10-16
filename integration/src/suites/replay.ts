import type { SimDriver } from '../driver/SimDriver.js';
import { prng } from '../util/prng.js';
import { demoSpec } from './spec.js';

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
    for (let clock = 0; clock < 12; clock += 1) {
      if (rng.int(3) === 0) peer.submit({ type: 'move', dir: rng.int(4) }, 0);
      peer.step(1);
      digests.push(peer.digest());
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
      if (replayPeer.digest() !== digest) {
        throw new Error(`replay diverged at tick ${String(cursor)}`);
      }
    }
  } finally {
    replayPeer.dispose();
  }
}
