import type { Context } from 'grammy';
import { pickLang, t } from '../i18n.js';
import { friendsKeyboard } from '../keyboards/main.js';

export function makeFriendsHandler(config: { botUsername: string }) {
  return async (ctx: Context) => {
    const from = ctx.from;
    if (!from) return;
    const lang = pickLang(from.language_code);
    const inviteUrl = `https://t.me/${config.botUsername}?start=ref_${from.id}`;
    await ctx.reply(t(lang, 'friends'), {
      reply_markup: friendsKeyboard(lang, inviteUrl),
    });
  };
}
