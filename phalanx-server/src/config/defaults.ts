import type {
  PhalanxConfig,
  GameModePreset,
  CustomGameMode,
} from '../types/index.js';

/**
 * Game mode presets configuration
 */
export const GAME_MODES: Record<GameModePreset, CustomGameMode> = {
  '1v1': { playersPerMatch: 2, teamsCount: 2 },
  '2v2': { playersPerMatch: 4, teamsCount: 2 },
  '3v3': { playersPerMatch: 6, teamsCount: 2 },
  '4v4': { playersPerMatch: 8, teamsCount: 2 },
  FFA4: { playersPerMatch: 4, teamsCount: 4 },
};

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: PhalanxConfig = {
  // Server
  port: 3000,
  cors: { origin: '*' },

  // Tick System
  tickRate: 20,
  tickDeadlineMs: 50,

  // Matchmaking
  gameMode: '1v1',
  matchmakingIntervalMs: 1000,
  countdownSeconds: 5,

  // Timeouts
  timeoutTicks: 40,
  disconnectTicks: 100,
  reconnectGracePeriodMs: 30000,

  // Command Validation
  maxTickBehind: 10,
  maxTickAhead: 5,

  // Command History (for reconnection)
  commandHistoryTicks: 200, // 10 seconds at 20 TPS

  // Determinism Features (Phase 2.1) - disabled by default for backward compatibility
  validateInputSequence: false,
  enableStateHashing: false,
  stateHashInterval: 60, // 3 seconds at 20 TPS

  // Ready Handshake
  readyTimeoutMs: 30000,

  // Desync Detection Behavior
  desync: {
    enabled: true,
    action: 'end-match', // 'log-only' | 'end-match'
    gracePeriodTicks: 1, // Consecutive desyncs before action
  },
};
