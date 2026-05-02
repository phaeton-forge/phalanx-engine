import type { Context } from 'grammy';
import type Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getOrCreateTelegramUser } from '../../db/telegramUsers.js';
import { pickLang, t } from '../i18n.js';
import {
  startNewKeyboard,
  startReturnKeyboard,
} from '../keyboards/main.js';
import {
  getAnimationInput,
  cacheFileId,
} from '../media/animationCache.js';
import type { Logger } from '../../log.js';

// Resolve relative to the *directory* of this file (handlers/) then go up
// handlers → bot → src → server (package root where gameplay.mp4 lives)
const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const GAMEPLAY_PATH = resolve(SERVER_DIR, 'gameplay.mp4');

export function makeStartHandler(
  db: Database.Database,
  config: { webAppUrl: string; botUsername: string },
  log: Logger,
) {
  return async (ctx: Context) => {
    const from = ctx.from;
    if (!from) return;

    const match = typeof ctx.match === 'string' ? ctx.match : undefined;
    const refMatch = match?.match(/^ref_(\d+)$/);
    const referredBy = refMatch ? parseInt(refMatch[1], 10) : undefined;

    const { user, isNew } = getOrCreateTelegramUser(db, {
      telegramId: from.id,
      username: from.username,
      firstName: from.first_name,
      languageCode: from.language_code,
      referredBy,
    });

    log.info({ userId: from.id, isNew }, '/start');

    const lang = pickLang(user.language_code ?? from.language_code);
    const inviteUrl = `https://t.me/${config.botUsername}?start=ref_${from.id}`;

    if (!isNew) {
      await ctx.reply(t(lang, 'startReturn'), {
        reply_markup: startReturnKeyboard(lang, config.webAppUrl),
      });
      return;
    }

    const animation = await getAnimationInput(GAMEPLAY_PATH, log);

    if (animation) {
      try {
        const msg = await ctx.replyWithAnimation(animation, {
          caption: t(lang, 'startNew'),
          parse_mode: 'Markdown',
          reply_markup: startNewKeyboard(lang, config.webAppUrl, inviteUrl),
        });
        if (
          msg.animation?.file_id &&
          typeof animation !== 'string'
        ) {
          cacheFileId(GAMEPLAY_PATH, msg.animation.file_id);
        }
      } catch (err) {
        log.warn({ err }, 'animation send failed — falling back to text');
        await ctx.reply(t(lang, 'startNew'), {
          parse_mode: 'Markdown',
          reply_markup: startNewKeyboard(lang, config.webAppUrl, inviteUrl),
        });
      }
    } else {
      await ctx.reply(t(lang, 'startNew'), {
        parse_mode: 'Markdown',
        reply_markup: startNewKeyboard(lang, config.webAppUrl, inviteUrl),
      });
    }
  };
}
