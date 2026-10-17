import { describe, it } from 'vitest';
import { runConformance } from '../src/adapters/conformance.js';
import { createCurrentDriver } from '../src/adapters/current.js';

describe('adapter conformance', () => {
  it('steps, replays, restores and rejects a bad command', async () => {
    await runConformance(createCurrentDriver());
  }, 60_000);
});
