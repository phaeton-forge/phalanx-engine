import type { SimDriver } from '../driver/SimDriver.js';
import { errorMessage } from '../util/json.js';
import { demoSpec } from '../suites/spec.js';

/**
 * Contract every adapter must pass. A 6.5 port is accepted when this
 * returns without throwing. Run from `it:unit` and from the quick profile.
 */
export async function runConformance(driver: SimDriver): Promise<void> {
  if (driver.capabilities.replayPlayer !== true) {
    throw new Error(`${driver.name}: conformance expected replayPlayer`);
  }
  const match = driver.createMatch(demoSpec(3));
  try {
    const authority = match.createPeer('A', { role: 'authority' });
    const replica = match.createPeer('B', { role: 'replica' });
    authority.submit({ type: 'move', dir: 99 }, 0);
    authority.step(1);
    if (authority.status() === 'failed') {
      throw new Error('rejected command failed the match');
    }
    const digests: string[] = [authority.digest()];
    for (let tick = 0; tick < 4; tick += 1) {
      authority.submit({ type: 'move', dir: tick % 4 }, 0);
      authority.step(1);
      digests.push(authority.digest());
    }
    const log = match.log();
    let cursor = -1;
    for (const digest of digests) {
      cursor += 1;
      const slice = log.filter((entry) => entry.tick === cursor);
      await replica.fastForward(slice, cursor);
      if (replica.digest() !== digest) {
        throw new Error(
          `conformance: replica diverged at tick ${String(cursor)}`
        );
      }
    }
    const bytes = authority.snapshot();
    const restored = match.createPeer('C', { role: 'replica' });
    restored.restore(bytes);
    if (restored.digest() !== authority.digest()) {
      throw new Error('conformance: restored digest mismatch');
    }
    restored.dispose();
    const handoff = authority.setController(0, 'bot', { policy: 'defensive' });
    if (handoff !== null) {
      throw new Error(`conformance: setController rejected: ${handoff}`);
    }
    authority.step(1);
    if (authority.controllerOf(0) !== 'bot') {
      throw new Error('conformance: slot stayed human after setController');
    }
    const unknown = authority.setController(9, 'bot', { policy: 'defensive' });
    if (unknown !== 'unknown slot') {
      throw new Error(`conformance: unknown slot returned ${String(unknown)}`);
    }
    const same = authority.setController(0, 'bot', { policy: 'defensive' });
    if (same !== 'slot is already bot') {
      throw new Error(`conformance: same mode returned ${String(same)}`);
    }
  } finally {
    match.dispose();
  }

  if (driver.capabilities.replayPlayer) {
    const match = driver.createMatch(demoSpec(4));
    let replay;
    try {
      const peer = match.createPeer('A', { role: 'authority' });
      peer.step(2);
      replay = peer.toReplay();
    } finally {
      match.dispose();
    }
    const replayPeer = driver.openReplay(replay);
    try {
      try {
        replayPeer.step(1);
        throw new Error('conformance: replay step did not throw');
      } catch (error) {
        if (!errorMessage(error).includes('fastForward')) throw error;
      }
    } finally {
      replayPeer.dispose();
    }
  }
}
