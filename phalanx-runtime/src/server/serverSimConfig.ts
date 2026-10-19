import type { ResourceLimits } from 'node:worker_threads';
import type { AnyGameDefinition } from '../game/GameDefinition.js';

/** Module path a worker imports. `export` defaults to `default`. */
export interface GameModuleSpec {
  module: string;
  export?: string;
  /**
   * Integer `matchConfig` keys copied into the runner config.
   * Every other extra key is rejected. Engine fields (`seed`, `side`,
   * `matchId`, …) are filled by the server and cannot be listed here.
   */
  configKeys?: readonly string[];
}

/**
 * Games this process can simulate, plus host options. `snapshotEveryTicks`
 * defaults to `DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS`. `maxMatches` caps
 * concurrent `simMode: 'server'` rooms.
 */
export interface ServerSimConfig {
  games: ReadonlyArray<AnyGameDefinition | GameModuleSpec>;
  mode?: 'worker' | 'inProcess';
  /**
   * Reserved until Task 17. Only `1` is accepted; a worker pool is not
   * implemented.
   */
  workers?: 1;
  resourceLimits?: ResourceLimits;
  snapshotEveryTicks?: number;
  maxMatches?: number;
}

const RESOURCE_LIMIT_KEYS = [
  'maxYoungGenerationSizeMb',
  'maxOldGenerationSizeMb',
  'codeRangeSizeMb',
  'stackSizeMb',
] as const;

/** Throws at `createServerSim`. Texts match the old host check with `sim.` */
export function validateServerSim(config: ServerSimConfig): void {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Invalid sim: must be an object.');
  }
  const games = config.games;
  if (!Array.isArray(games)) {
    throw new Error('Invalid games: must be an array.');
  }
  if (games.length === 0) {
    throw new Error('Invalid games: must be a non-empty array.');
  }
  if (
    config.mode !== undefined &&
    config.mode !== 'worker' &&
    config.mode !== 'inProcess'
  ) {
    throw new Error(
      `Invalid sim.mode: ${String(config.mode)}. Must be 'worker' or 'inProcess'.`
    );
  }
  if (config.workers !== undefined && config.workers !== 1) {
    throw new Error(
      `Invalid sim.workers: ${String(config.workers)}. Reserved until Task 17; only 1 is accepted.`
    );
  }
  if (
    config.snapshotEveryTicks !== undefined &&
    (!Number.isInteger(config.snapshotEveryTicks) ||
      config.snapshotEveryTicks < 1)
  ) {
    throw new Error(
      `Invalid sim.snapshotEveryTicks: ${String(config.snapshotEveryTicks)}. Must be an integer >= 1.`
    );
  }
  if (
    config.maxMatches !== undefined &&
    (!Number.isInteger(config.maxMatches) || config.maxMatches < 1)
  ) {
    throw new Error(
      `Invalid sim.maxMatches: ${String(config.maxMatches)}. Must be an integer >= 1.`
    );
  }
  const limits = config.resourceLimits;
  if (limits !== undefined) {
    if (typeof limits !== 'object' || limits === null) {
      throw new Error('Invalid sim.resourceLimits: must be an object.');
    }
    for (const key of RESOURCE_LIMIT_KEYS) {
      const value = limits[key];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(
          `Invalid sim.resourceLimits.${key}: must be a finite number > 0.`
        );
      }
    }
  }
}
