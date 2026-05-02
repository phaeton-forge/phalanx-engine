import type { Context } from 'grammy';
import { pickLang, t } from '../i18n.js';

export function makeHelpHandler() {
  return async (ctx: Context) => {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
    const lang = pickLang(ctx.from?.language_code);
    await ctx.reply(t(lang, 'help'), { parse_mode: 'Markdown' });
  };
}
