/**
 * Chapayev game server using Phalanx Engine
 *
 * Minimal server: matchmaking, tick clock, command relay, desync detection.
 * No game logic — all simulation runs on clients (lockstep).
 */

import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Phalanx } from '@phalanx-engine/server';
import { parseConfig } from './config.js';
import { log } from './log.js';
import { openDb, closeDb } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { mountBot } from './bot/index.js';
import type { Bot } from 'grammy';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = resolve(SERVER_DIR, '../.env');
loadDotenv({ path: ENV_FILE_PATH });

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://192.168.0.157:5174',
] as const;

function parseCorsOrigins(value: string | undefined): string[] {
  if (!value) return [...DEFAULT_CORS_ORIGINS];
  const origins = value
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return origins.length > 0 ? origins : [...DEFAULT_CORS_ORIGINS];
}

async function main() {
  const config = parseConfig();
  const corsOrigins = parseCorsOrigins(config.CORS_ORIGINS);

  log.info('Starting Chapayev server...');
  log.info({ origins: corsOrigins }, 'CORS origins');

  // Open DB and run migrations
  const MIGRATIONS_DIR = resolve(SERVER_DIR, '../migrations');
  const db = openDb(config.DATABASE_PATH);
  runMigrations(db, MIGRATIONS_DIR);
  log.info({ path: config.DATABASE_PATH }, 'DB ready');

  // Build bot (optional)
  let bot: Bot | null = null;
  let extraRequestHandler: ((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<boolean>) | undefined;
  let phalanx: Phalanx | null = null;

  if (config.BOT_ENABLED) {
    const mounted = await mountBot(config, {
      db,
      log,
      createPrivateRoom: (request) => {
        if (!phalanx) {
          throw new Error('Game server is not ready');
        }
        return phalanx.createPrivateRoomForHost(request);
      },
    });
    bot = mounted.bot;
    extraRequestHandler = mounted.requestHandler;
    log.info('Telegram bot mounted');
  }

  phalanx = new Phalanx({
    port: config.PORT,
    cors: { origin: corsOrigins, credentials: true },
    tickMode: 'event',
    tickRate: 20,
    gameMode: '1v1',
    countdownSeconds: 3,
    matchmakingIntervalMs: 1000,
    timeoutTicks: 60,
    disconnectTicks: 200,
    reconnectGracePeriodMs: 30000,
    readyTimeoutMs: 90000,
    playersConnectTimeoutMs: 90000,
    enableStateHashing: true,
    stateHashInterval: 60,
    desync: { enabled: true, action: 'log-only', gracePeriodTicks: 3 },
    extraRequestHandler,
  });

  phalanx.on('match-created', (match) => log.info({ matchId: match.id }, 'match created'));
  phalanx.on('match-started', (match) => log.info({ matchId: match.id }, 'match started'));
  phalanx.on('match-ended', (matchId, reason) => log.info({ matchId, reason }, 'match ended'));
  phalanx.on('player-disconnected', (playerId, matchId) =>
    log.info({ playerId, matchId }, 'player disconnected'),
  );
  phalanx.on('player-reconnected', (playerId, matchId) =>
    log.info({ playerId, matchId }, 'player reconnected'),
  );
  phalanx.on('desync-detected', (matchId, tick, hashes) =>
    log.warn({ matchId, tick, hashes }, 'desync detected'),
  );

  try {
    await phalanx.start();
    log.info({ port: config.PORT }, 'Chapayev server running');
  } catch (error) {
    log.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }

  // Register webhook after server is up
  if (bot && config.BOT_ENABLED) {
    const webhookUrl = `${config.PUBLIC_URL}${config.TELEGRAM_WEBHOOK_PATH}/${config.TELEGRAM_WEBHOOK_SECRET}`;
    try {
      await bot.api.setWebhook(webhookUrl, {
        secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      });
      // Log only the path portion — never the secret embedded in the URL
      log.info(
        { webhookPath: `${config.PUBLIC_URL}${config.TELEGRAM_WEBHOOK_PATH}/<secret>` },
        'Telegram webhook registered',
      );
    } catch (err) {
      log.error({ err }, 'Failed to register Telegram webhook — shutting down');
      await shutdown();
      return;
    }
  }

  async function shutdown() {
    log.info('Shutting down...');
    if (bot) {
      try {
        await bot.api.deleteWebhook();
      } catch {
        // best-effort
      }
    }
    if (phalanx) {
      await phalanx.stop();
    }
    closeDb();
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
