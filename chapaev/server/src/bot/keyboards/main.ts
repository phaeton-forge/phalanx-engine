import { InlineKeyboard } from 'grammy';
import type { Lang } from '../i18n.js';
import { t } from '../i18n.js';

export function startNewKeyboard(
  lang: Lang,
  webAppUrl: string,
  inviteUrl: string,
): InlineKeyboard {
  return new InlineKeyboard()
    .webApp(t(lang, 'btnPlay'), webAppUrl)
    .row()
    .url(t(lang, 'btnInvite'), inviteUrl)
    .row()
    .text(t(lang, 'btnRules'), 'show_rules');
}

export function startReturnKeyboard(
  lang: Lang,
  webAppUrl: string,
): InlineKeyboard {
  return new InlineKeyboard().webApp(t(lang, 'btnPlay'), webAppUrl);
}

export function playKeyboard(lang: Lang, webAppUrl: string): InlineKeyboard {
  return new InlineKeyboard().webApp(t(lang, 'btnPlay'), webAppUrl);
}

export function friendsKeyboard(
  lang: Lang,
  inviteUrl: string,
): InlineKeyboard {
  return new InlineKeyboard().url(t(lang, 'btnInvite'), inviteUrl);
}
