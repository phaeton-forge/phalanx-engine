/**
 * Chapayev game server using Phalanx Engine
 *
 * Minimal server: matchmaking, tick clock, command relay, desync detection.
 * No game logic — all simulation runs on clients (lockstep).
 */

import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Phalanx } from 'phalanx-server';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = resolve(SERVER_DIR, '../.env');
const dotenvResult = loadDotenv({ path: ENV_FILE_PATH });

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://192.168.0.157:5174',
] as const;

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value) {
    return [...DEFAULT_CORS_ORIGINS];
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : [...DEFAULT_CORS_ORIGINS];
}

const PORT = parseInt(process.env.PORT || '3000', 10);

const CORS_ORIGINS = parseCorsOrigins(process.env.CORS_ORIGINS);

// Auth configuration — enable if GOOGLE_CLIENT_ID is set
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

async function main() {
  console.log('Starting Chapayev server...');
  if (dotenvResult.error) {
    console.warn(`[Config] Failed to load env file at ${ENV_FILE_PATH}. Using process environment defaults.`);
  } else {
    console.log(`[Config] Loaded env file: ${ENV_FILE_PATH}`);
  }
  console.log(`[Config] Allowed CORS origins: ${CORS_ORIGINS.join(', ')}`);

  if (GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID is set but GOOGLE_CLIENT_SECRET is missing — both are required for OAuth');
  }
  if (!GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_SECRET is set but GOOGLE_CLIENT_ID is missing — both are required for OAuth');
  }

  const authEnabled = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
  if (authEnabled) {
    console.log('[Auth] Google OAuth enabled');
  } else {
    console.log('[Auth] Running without authentication (dev mode)');
  }

  const phalanx = new Phalanx({
    port: PORT,
    cors: {
      origin: CORS_ORIGINS,
      credentials: true,
    },
    tickMode: 'event',
    tickRate: 20,
    gameMode: '1v1',
    countdownSeconds: 3,
    matchmakingIntervalMs: 1000,
    timeoutTicks: 60,
    disconnectTicks: 200,
    reconnectGracePeriodMs: 30000,
    // Mobile hosts on carrier networks can stop receiving packets during
    // countdown, while Socket.IO only reports `ping timeout` ~25-30s later.
    // Keep the pre-ready match alive long enough for that disconnect to be
    // detected and for `room-recover` to reclaim the match by room code.
    readyTimeoutMs: 90000,
    playersConnectTimeoutMs: 90000,
    enableStateHashing: true,
    stateHashInterval: 60,
    desync: {
      enabled: true,
      action: 'log-only',
      gracePeriodTicks: 3,
    },
    // Auth — only enabled if Google credentials are configured
    auth: authEnabled ? {
      enabled: true,
      google: {
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
      },
      allowAnonymous: true, // Allow unauthenticated connections in dev
    } : undefined,
  });

  // TODO (Stage 3): Add server-side command validation via phalanx.on('player-command')
  // to reject invalid command types, malformed payloads, and commands targeting wrong team.
  // See: PhalanxEventHandlers['player-command'] — return false to reject a command.

  phalanx.on('match-created', (match) => {
    console.log(`Match created: ${match.id}`);
  });

  phalanx.on('match-started', (match) => {
    console.log(`Match started: ${match.id}`);
  });

  phalanx.on('match-ended', (matchId: string, reason: string) => {
    console.log(`Match ended: ${matchId}, reason: ${reason}`);
  });

  phalanx.on('player-disconnected', (playerId: string, matchId: string) => {
    console.log(`Player ${playerId} disconnected from ${matchId}`);
  });

  phalanx.on('player-reconnected', (playerId: string, matchId: string) => {
    console.log(`Player ${playerId} reconnected to ${matchId}`);
  });

  phalanx.on('desync-detected', (matchId: string, tick: number, hashes: Record<string, string>) => {
    console.warn(`Desync detected in ${matchId} at tick ${tick}:`, hashes);
  });

  try {
    await phalanx.start();
    console.log(`Chapayev server running on port ${PORT}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    void phalanx.stop().then(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    void phalanx.stop().then(() => process.exit(0));
  });
}

void main();
