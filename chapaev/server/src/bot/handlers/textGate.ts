import type { Context, MiddlewareFn } from 'grammy';
import type Database from 'better-sqlite3';
import { pickLang, t } from '../i18n.js';
import { textGateKeyboard } from '../keyboards/feedback.js';
import { getUserState } from '../userState.js';

function isCommand(ctx: Context): boolean {
  const text = ctx.message?.text ?? ctx.message?.caption;
  if (!text?.startsWith('/')) return false;

  return (
    ctx.message?.entities?.some(
      (entity) => entity.type === 'bot_command' && entity.offset === 0,
    ) ??
    ctx.message?.caption_entities?.some(
      (entity) => entity.type === 'bot_command' && entity.offset === 0,
    ) ??
    true
  );
}

export function makeTextGateMiddleware(
  db: Database.Database,
  webAppUrl: string,
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (ctx.callbackQuery || !ctx.message || isCommand(ctx)) {
      return next();
    }

    const userId = ctx.from?.id;
    if (userId == null) return next();

    if (getUserState(db, userId).state === 'awaiting_feedback') {
      return next();
    }

    const lang = pickLang(ctx.from?.language_code);
    await ctx.reply(t(lang, 'textGate'), {
      reply_markup: textGateKeyboard(lang, webAppUrl),
    });
  };
}
