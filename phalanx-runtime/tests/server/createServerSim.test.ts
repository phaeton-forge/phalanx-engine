import { describe, expect, it } from 'vitest';
import { createServerSim } from '../../src/server/createServerSim.js';

const game = {
  module: './game.js',
  export: 'Game',
};

describe('createServerSim validation', () => {
  it('rejects a missing config', () => {
    expect(() => createServerSim(undefined as never)).toThrow(
      'Invalid sim: must be an object.'
    );
  });

  it('rejects games that are not an array', () => {
    expect(() => createServerSim({ games: undefined as never })).toThrow(
      'Invalid games: must be an array.'
    );
  });

  it('rejects an empty games list', () => {
    expect(() => createServerSim({ games: [] })).toThrow(
      'Invalid games: must be a non-empty array.'
    );
  });

  it('rejects an unknown mode', () => {
    expect(() =>
      createServerSim({
        games: [game],
        mode: 'thread' as 'worker',
      })
    ).toThrow("Invalid sim.mode: thread. Must be 'worker' or 'inProcess'.");
  });

  it('rejects workers other than 1', () => {
    expect(() =>
      createServerSim({
        games: [game],
        workers: 2 as 1,
      })
    ).toThrow(
      'Invalid sim.workers: 2. Reserved until Task 17; only 1 is accepted.'
    );
  });

  it('rejects a bad snapshot interval', () => {
    expect(() =>
      createServerSim({ games: [game], snapshotEveryTicks: 0 })
    ).toThrow('Invalid sim.snapshotEveryTicks: 0. Must be an integer >= 1.');
  });

  it('rejects a bad match cap', () => {
    expect(() => createServerSim({ games: [game], maxMatches: 1.5 })).toThrow(
      'Invalid sim.maxMatches: 1.5. Must be an integer >= 1.'
    );
  });

  it('rejects resource limits that are not an object', () => {
    expect(() =>
      createServerSim({
        games: [game],
        resourceLimits: null as never,
      })
    ).toThrow('Invalid sim.resourceLimits: must be an object.');
  });

  it('rejects a non-positive resource limit', () => {
    expect(() =>
      createServerSim({
        games: [game],
        resourceLimits: { maxOldGenerationSizeMb: 0 },
      })
    ).toThrow(
      'Invalid sim.resourceLimits.maxOldGenerationSizeMb: must be a finite number > 0.'
    );
  });
});
