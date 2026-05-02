import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bot } from 'grammy';
import { getOrCreateTelegramUser } from '../../src/db/telegramUsers.js';
import { runMigrations } from '../../src/db/migrate.js';
import { makeStartHandler } from '../../src/bot/handlers/start.js';
import pino from 'pino';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(TEST_DIR, '../../migrations');

const log = pino({ level: 'silent' });

function buildInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR);
  return db;
}

interface CapturedCall {
  method: string;
  payload: Record<string, unknown>;
}

function createTestBot(): { bot: Bot; calls: CapturedCall[] } {
  const bot = new Bot('test-token', { botInfo: {
    id: 1,
    is_bot: true,
    first_name: 'TestBot',
    username: 'test_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } });
  const calls: CapturedCall[] = [];

  bot.api.config.use(async (prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'sendMessage') {
      return { ok: true, result: { message_id: 1, chat: { id: 1 }, date: 0, text: '' } } as unknown as ReturnType<typeof prev>;
    }
    if (method === 'sendAnimation') {
      return { ok: true, result: { message_id: 1, chat: { id: 1 }, date: 0, animation: { file_id: 'cached_id', file_unique_id: 'x', width: 0, height: 0, duration: 0 } } } as unknown as ReturnType<typeof prev>;
    }
    return { ok: true, result: true } as unknown as ReturnType<typeof prev>;
  });

  return { bot, calls };
}

function makeUpdate(userId: number, text: string, _startParam?: string) {
  const commandLength = text.split(' ')[0].length;
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      chat: { id: userId, type: 'private' as const },
      from: {
        id: userId,
        is_bot: false,
        first_name: 'User',
        language_code: 'en',
      },
      date: Math.floor(Date.now() / 1000),
      text,
      entities: [{ type: 'bot_command' as const, offset: 0, length: commandLength }],
    },
  };
}

const CONFIG = {
  webAppUrl: 'https://t.me/TestBot/app',
  botUsername: 'TestBot',
};

describe('/start handler', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = buildInMemoryDb();
  });

  it('creates a new user without referral', async () => {
    const { bot, calls } = createTestBot();
    bot.command('start', makeStartHandler(db, CONFIG, log));

    await bot.handleUpdate(makeUpdate(100, '/start'));

    const row = db
      .prepare('SELECT * FROM telegram_users WHERE telegram_id = ?')
      .get(100) as { referred_by: number | null } | undefined;
    expect(row).toBeDefined();
    expect(row!.referred_by).toBeNull();
    expect(calls.some((c) => c.method === 'sendMessage' || c.method === 'sendAnimation')).toBe(true);
  });

  it('sets referred_by for a valid referral', async () => {
    // Pre-create referrer
    getOrCreateTelegramUser(db, { telegramId: 200, firstName: 'Referrer' });

    const { bot } = createTestBot();
    bot.command('start', makeStartHandler(db, CONFIG, log));

    const update = makeUpdate(300, '/start ref_200', 'ref_200');
    // Inject match into ctx — simulate /start ref_200
    bot.use(async (ctx, next) => {
      if (ctx.message?.text === '/start ref_200') {
        (ctx as unknown as { match: string }).match = 'ref_200';
      }
      return next();
    });
    await bot.handleUpdate(update);

    const row = db
      .prepare('SELECT referred_by FROM telegram_users WHERE telegram_id = ?')
      .get(300) as { referred_by: number | null } | undefined;
    expect(row?.referred_by).toBe(200);
  });

  it('rejects self-referral', async () => {
    const { bot } = createTestBot();
    bot.use(async (ctx, next) => {
      if (ctx.message?.text === '/start ref_400') {
        (ctx as unknown as { match: string }).match = 'ref_400';
      }
      return next();
    });
    bot.command('start', makeStartHandler(db, CONFIG, log));

    await bot.handleUpdate(makeUpdate(400, '/start ref_400', 'ref_400'));

    const row = db
      .prepare('SELECT referred_by FROM telegram_users WHERE telegram_id = ?')
      .get(400) as { referred_by: number | null } | undefined;
    expect(row?.referred_by).toBeNull();
  });

  it('does not overwrite referred_by on returning user', async () => {
    // Create referrer and user already referred
    getOrCreateTelegramUser(db, { telegramId: 500, firstName: 'Referrer' });
    getOrCreateTelegramUser(db, {
      telegramId: 600,
      firstName: 'User',
      referredBy: 500,
    });

    // Attempt to re-refer by a different person (700 doesn't exist — no laundering)
    const { bot } = createTestBot();
    bot.use(async (ctx, next) => {
      if (ctx.message?.text === '/start ref_700') {
        (ctx as unknown as { match: string }).match = 'ref_700';
      }
      return next();
    });
    bot.command('start', makeStartHandler(db, CONFIG, log));

    await bot.handleUpdate(makeUpdate(600, '/start ref_700', 'ref_700'));

    const row = db
      .prepare('SELECT referred_by FROM telegram_users WHERE telegram_id = ?')
      .get(600) as { referred_by: number | null } | undefined;
    expect(row?.referred_by).toBe(500);
  });
});
