import { describe, it } from 'vitest';
import { runConformance } from '../src/adapters/conformance.js';
import { createV65Driver } from '../src/adapters/v65.js';

describe('adapter conformance', () => {
  it('steps, replays, restores and rejects a bad command', async () => {
    await runConformance(createV65Driver());
  }, 60_000);
});
