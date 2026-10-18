import type { PhalanxConfig } from '../types/index.js';
import { DEFAULT_CONFIG, GAME_MODES } from './defaults.js';

/**
 * Validates and merges user configuration with defaults
 * @param userConfig - Partial user configuration
 * @returns Complete validated configuration
 */
export function validateConfig(
  userConfig: Partial<PhalanxConfig> = {}
): PhalanxConfig {
  const config: PhalanxConfig = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    cors: {
      ...DEFAULT_CONFIG.cors,
      ...(userConfig.cors || {}),
    },
    desync: {
      ...DEFAULT_CONFIG.desync,
      ...(userConfig.desync || {}),
    },
  };

  // Validate port. 0 asks the OS for an ephemeral port (tests).
  if (config.port !== 0 && (config.port < 1 || config.port > 65535)) {
    throw new Error(
      `Invalid port: ${config.port}. Must be 0 or between 1 and 65535.`
    );
  }

  // Validate tickRate
  if (config.tickRate < 1 || config.tickRate > 128) {
    throw new Error(
      `Invalid tickRate: ${config.tickRate}. Must be between 1 and 128.`
    );
  }

  // Validate tickDeadlineMs
  if (config.tickDeadlineMs < 1) {
    throw new Error(
      `Invalid tickDeadlineMs: ${config.tickDeadlineMs}. Must be positive.`
    );
  }

  // Validate gameMode
  if (typeof config.gameMode === 'string') {
    if (!GAME_MODES[config.gameMode]) {
      throw new Error(
        `Invalid gameMode: ${config.gameMode}. Valid presets: ${Object.keys(GAME_MODES).join(', ')}`
      );
    }
  } else if (typeof config.gameMode === 'object') {
    if (config.gameMode.playersPerMatch < 2) {
      throw new Error('playersPerMatch must be at least 2');
    }
    if (config.gameMode.teamsCount < 1) {
      throw new Error('teamsCount must be at least 1');
    }
    if (config.gameMode.teamsCount > config.gameMode.playersPerMatch) {
      throw new Error('teamsCount cannot exceed playersPerMatch');
    }
  }

  // Validate timeout values
  if (config.timeoutTicks < 1) {
    throw new Error('timeoutTicks must be positive');
  }
  if (config.disconnectTicks < config.timeoutTicks) {
    throw new Error('disconnectTicks must be >= timeoutTicks');
  }

  // Validate tick range limits
  if (config.maxTickBehind < 1) {
    throw new Error('maxTickBehind must be positive');
  }
  if (config.maxTickAhead < 1) {
    throw new Error('maxTickAhead must be positive');
  }

  // Task 9. Absent `session` means tokens are not issued.
  if (config.session !== undefined) {
    const { secret, ttlMs } = config.session;
    if (typeof secret !== 'string' || secret.length < 32) {
      throw new Error(
        'Invalid session.secret: must be a string of at least 32 characters.'
      );
    }
    if (ttlMs !== undefined && (!Number.isInteger(ttlMs) || ttlMs <= 0)) {
      throw new Error(
        `Invalid session.ttlMs: ${String(ttlMs)}. Must be an integer > 0.`
      );
    }
  }
  if (
    config.reconnect?.requireSessionToken !== undefined &&
    typeof config.reconnect.requireSessionToken !== 'boolean'
  ) {
    throw new Error(
      'Invalid reconnect.requireSessionToken: must be a boolean.'
    );
  }
  if (
    config.reconnect?.requireSessionToken === true &&
    config.session === undefined
  ) {
    throw new Error('reconnect.requireSessionToken requires session.secret.');
  }

  // Task 10. Absent means the timer is off (today's behaviour).
  if (config.absence !== undefined) {
    const { windowMs, matchBudgetMs } = config.absence;
    if (!Number.isInteger(windowMs) || windowMs <= 0) {
      throw new Error(
        `Invalid absence.windowMs: ${String(windowMs)}. Must be an integer > 0.`
      );
    }
    if (!Number.isInteger(matchBudgetMs) || matchBudgetMs <= 0) {
      throw new Error(
        `Invalid absence.matchBudgetMs: ${String(matchBudgetMs)}. Must be an integer > 0.`
      );
    }
  }

  // Task 8
  if (
    config.commandHistoryTicks !== 'full' &&
    (!Number.isInteger(config.commandHistoryTicks) ||
      config.commandHistoryTicks < 1)
  ) {
    throw new Error(
      `Invalid commandHistoryTicks: ${String(config.commandHistoryTicks)}. Must be an integer >= 1 or 'full'.`
    );
  }
  if (
    config.shutdownGraceMs !== undefined &&
    (!Number.isInteger(config.shutdownGraceMs) || config.shutdownGraceMs < 0)
  ) {
    throw new Error(
      `Invalid shutdownGraceMs: ${String(config.shutdownGraceMs)}. Must be an integer >= 0.`
    );
  }

  // Task 8.1. Absent means the match log is released and not archived.
  if (
    config.onMatchArchived !== undefined &&
    typeof config.onMatchArchived !== 'function'
  ) {
    throw new Error(
      `Invalid onMatchArchived: ${String(config.onMatchArchived)}. Must be a function.`
    );
  }

  // Task 11. Absent `games` means a pure relay and no worker.
  validateSimHost(config);

  return config;
}

const RESOURCE_LIMIT_KEYS = [
  'maxYoungGenerationSizeMb',
  'maxOldGenerationSizeMb',
  'codeRangeSizeMb',
  'stackSizeMb',
] as const;

function validateSimHost(config: PhalanxConfig): void {
  const games = config.games;
  if (games !== undefined && !Array.isArray(games)) {
    throw new Error('Invalid games: must be an array.');
  }
  const sim = config.simHost;
  if (sim === undefined) return;
  if (typeof sim !== 'object') {
    throw new Error('Invalid simHost: must be an object.');
  }
  if (
    sim.mode !== undefined &&
    sim.mode !== 'worker' &&
    sim.mode !== 'inProcess'
  ) {
    throw new Error(
      `Invalid simHost.mode: ${String(sim.mode)}. Must be 'worker' or 'inProcess'.`
    );
  }
  if (sim.workers !== undefined && sim.workers !== 1) {
    throw new Error(
      `Invalid simHost.workers: ${String(sim.workers)}. Only 1 worker is supported.`
    );
  }
  if (
    sim.snapshotEveryTicks !== undefined &&
    (!Number.isInteger(sim.snapshotEveryTicks) || sim.snapshotEveryTicks < 1)
  ) {
    throw new Error(
      `Invalid simHost.snapshotEveryTicks: ${String(sim.snapshotEveryTicks)}. Must be an integer >= 1.`
    );
  }
  if (
    sim.maxMatches !== undefined &&
    (!Number.isInteger(sim.maxMatches) || sim.maxMatches < 1)
  ) {
    throw new Error(
      `Invalid simHost.maxMatches: ${String(sim.maxMatches)}. Must be an integer >= 1.`
    );
  }
  const limits = sim.resourceLimits;
  if (limits !== undefined) {
    if (typeof limits !== 'object' || limits === null) {
      throw new Error('Invalid simHost.resourceLimits: must be an object.');
    }
    for (const key of RESOURCE_LIMIT_KEYS) {
      const value = limits[key];
      if (value === undefined) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(
          `Invalid simHost.resourceLimits.${key}: must be a finite number > 0.`
        );
      }
    }
  }
}

/**
 * Gets the resolved game mode (players per match and teams count)
 */
export function resolveGameMode(gameMode: PhalanxConfig['gameMode']): {
  playersPerMatch: number;
  teamsCount: number;
} {
  if (typeof gameMode === 'string') {
    return GAME_MODES[gameMode];
  }
  return gameMode;
}
