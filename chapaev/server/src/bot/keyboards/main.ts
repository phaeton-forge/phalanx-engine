import { InlineKeyboard } from 'grammy';
import type { Lang } from '../i18n.js';
import { t } from '../i18n.js';

interface CopyTextButton {
  text: string;
  copy_text: {
    text: string;
  };
}

export function startNewKeyboard(
  lang: Lang,
  webAppUrl: string,
  inviteUrl: string,
): InlineKeyboard {
  return new InlineKeyboard()
    .url(t(lang, 'btnPlay'), webAppUrl)
    .row()
    .url(t(lang, 'btnInvite'), inviteUrl)
    .row()
    .text(t(lang, 'btnRules'), 'show_rules');
}

export function startReturnKeyboard(
  lang: Lang,
  webAppUrl: string,
): InlineKeyboard {
  return new InlineKeyboard().url(t(lang, 'btnPlay'), webAppUrl);
}

export function playKeyboard(lang: Lang, webAppUrl: string): InlineKeyboard {
  return new InlineKeyboard().url(t(lang, 'btnPlay'), webAppUrl);
}

export function friendsKeyboard(
  lang: Lang,
  inviteUrl: string,
): InlineKeyboard {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteUrl)}&text=${encodeURIComponent(t(lang, 'friendsShareText'))}`;
  const copyButton: CopyTextButton = {
    text: t(lang, 'btnCopyLink'),
    copy_text: { text: inviteUrl },
  };

  return new InlineKeyboard()
    .url(t(lang, 'btnPlay'), inviteUrl)
    .row()
    .url(t(lang, 'btnShare'), shareUrl)
    .row()
    .add(copyButton);
}
