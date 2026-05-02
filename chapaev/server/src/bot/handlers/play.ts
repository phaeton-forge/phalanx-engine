import type { Context } from 'grammy';
import { pickLang, t } from '../i18n.js';
import { playKeyboard } from '../keyboards/main.js';

export function makePlayHandler(config: { webAppUrl: string }) {
  return async (ctx: Context) => {
    const lang = pickLang(ctx.from?.language_code);
    await ctx.reply(t(lang, 'play'), {
      reply_markup: playKeyboard(lang, config.webAppUrl),
    });
  };
}
