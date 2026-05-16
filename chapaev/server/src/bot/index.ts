import { Bot } from 'grammy';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { Logger } from '../log.js';
import { consume } from './ratelimit.js';
import { makeStartHandler } from './handlers/start.js';
import { makePlayHandler } from './handlers/play.js';
import { makeFriendsHandler } from './handlers/friends.js';
import { makeHelpHandler } from './handlers/help.js';
import { makeFeedbackHandlers } from './handlers/feedback.js';
import { makeTextGateMiddleware } from './handlers/textGate.js';
import { applyBotSettings } from './setup.js';
import { ensureUserStateTable } from './userState.js';

export interface BotPrivateRoomRequest {
  playerId: string;
  username?: string;
  gameType?: string;
}

export interface BotPrivateRoomResult {
  code: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 512 * 1024) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const seenUpdateIds = new Map<number, number>();
const DEDUP_MAX = 1000;

function isDuplicate(updateId: number): boolean {
  if (seenUpdateIds.has(updateId)) return true;
  seenUpdateIds.set(updateId, Date.now());
  if (seenUpdateIds.size > DEDUP_MAX) {
    const oldest = [...seenUpdateIds.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) seenUpdateIds.delete(oldest[0]);
  }
  return false;
}

export function createBot(token: string): Bot {
  return new Bot(token);
}

export async function mountBot(
  config: Config,
  deps: {
    db: Database.Database;
    log: Logger;
    createPrivateRoom: (request: BotPrivateRoomRequest) => BotPrivateRoomResult;
  },
): Promise<{
  bot: Bot;
  requestHandler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
}> {
  const { db, log } = deps;
  const token = config.TELEGRAM_BOT_TOKEN!;
  const webAppUrl = config.WEB_APP_URL!;
  const botUsername = config.BOT_USERNAME!;
  const telegramAppName = config.TELEGRAM_APP_NAME;
  const webhookSecret = config.TELEGRAM_WEBHOOK_SECRET!;
  const webhookPath = `${config.TELEGRAM_WEBHOOK_PATH}/${webhookSecret}`;
  const feedbackChatId = config.FEEDBACK_CHAT_ID!;

  const bot = createBot(token);
  ensureUserStateTable(db);

  // grammy requires bot info to be loaded before handling webhook updates
  await bot.init();
  await applyBotSettings(bot);

  // update_id LRU dedup
  bot.use(async (ctx, next) => {
    if (ctx.update.update_id != null && isDuplicate(ctx.update.update_id)) {
      return;
    }
    return next();
  });

  // Per-user rate limit
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (id != null && !consume(id)) return;
    return next();
  });

  bot.use(makeTextGateMiddleware(db, webAppUrl));

  const startHandler = makeStartHandler(db, { webAppUrl, botUsername }, log);
  const playHandler = makePlayHandler({ webAppUrl });
  const friendsHandler = makeFriendsHandler({
    botUsername,
    telegramAppName,
    webAppUrl,
    createPrivateRoom: deps.createPrivateRoom,
  });
  const helpHandler = makeHelpHandler();
  const feedbackHandlers = makeFeedbackHandlers(db, log, feedbackChatId);

  bot.command('start', startHandler);
  bot.command('play', playHandler);
  bot.command('feedback', feedbackHandlers.entryHandler);
  bot.command('invite', friendsHandler);
  bot.command('friends', friendsHandler);
  bot.command('rules', helpHandler);
  bot.command('help', helpHandler);
  bot.command('cancel', feedbackHandlers.cancelHandler);
  bot.callbackQuery('show_rules', helpHandler);
  bot.callbackQuery('feedback_start', feedbackHandlers.entryHandler);
  bot.callbackQuery(
    /^feedback_(bug|idea|review|cancel)$/,
    feedbackHandlers.categoryHandler,
  );
  bot.on('message', feedbackHandlers.messageHandler);

  const requestHandler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> => {
    if (req.url !== webhookPath || req.method !== 'POST') return false;

    // Validate secret token
    if (req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret) {
      res.writeHead(401);
      res.end();
      return true;
    }

    try {
      const body = await readBody(req);
      const update = JSON.parse(body) as Parameters<Bot['handleUpdate']>[0];
      await bot.handleUpdate(update);
      res.writeHead(200);
      res.end();
    } catch (err) {
      log.error({ err }, 'webhook handler error');
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    }
    return true;
  };

  return { bot, requestHandler };
}
