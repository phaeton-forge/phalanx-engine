import type { Context } from 'grammy';
import { pickLang, t } from '../i18n.js';
import { friendsKeyboard } from '../keyboards/main.js';

interface FriendsHandlerConfig {
  botUsername: string;
  telegramAppName?: string;
  webAppUrl: string;
  createPrivateRoom: (request: {
    playerId: string;
    username?: string;
  }) => { code: string };
}

function telegramPlayerId(telegramId: number): string {
  return `telegram:${telegramId}`;
}

function appNameFromWebAppUrl(webAppUrl: string, botUsername: string): string | null {
  try {
    const url = new URL(webAppUrl);
    const host = url.hostname.toLowerCase();
    if (host !== 't.me' && host !== 'telegram.me') return null;

    const [bot, app] = url.pathname
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (!bot || !app) return null;
    if (bot.toLowerCase() !== botUsername.toLowerCase()) return null;

    return app;
  } catch {
    return null;
  }
}

function roomInviteUrl(config: FriendsHandlerConfig, roomCode: string): string {
  const code = roomCode.trim().toUpperCase();
  const configuredAppName = config.telegramAppName?.trim();
  const appName =
    configuredAppName && configuredAppName.length > 0
      ? configuredAppName
      : appNameFromWebAppUrl(config.webAppUrl, config.botUsername);

  if (appName) {
    return `https://t.me/${config.botUsername}/${appName}?startapp=${encodeURIComponent(code)}`;
  }

  return `https://t.me/${config.botUsername}?startapp=${encodeURIComponent(code)}`;
}

export function makeFriendsHandler(config: FriendsHandlerConfig) {
  return async (ctx: Context) => {
    const from = ctx.from;
    if (!from) return;
    const lang = pickLang(from.language_code);

    let roomCode: string;
    try {
      const room = config.createPrivateRoom({
        playerId: telegramPlayerId(from.id),
        username: from.username ?? from.first_name,
      });
      roomCode = room.code;
    } catch {
      await ctx.reply(t(lang, 'friendsError'));
      return;
    }

    const inviteUrl = roomInviteUrl(config, roomCode);
    await ctx.reply(`${t(lang, 'friends')}\n\n${inviteUrl}`, {
      reply_markup: friendsKeyboard(lang, inviteUrl),
    });
  };
}
