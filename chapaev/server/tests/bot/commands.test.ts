import { describe, expect, it } from 'vitest';
import { Bot } from 'grammy';
import { makeHelpHandler } from '../../src/bot/handlers/help.js';
import { makePlayHandler } from '../../src/bot/handlers/play.js';
import { t } from '../../src/bot/i18n.js';

interface CapturedCall {
  method: string;
  payload: Record<string, unknown>;
}

interface ReplyMarkup {
  inline_keyboard?: Array<Array<Record<string, unknown>>>;
}

function createTestBot(): { bot: Bot; calls: CapturedCall[] } {
  const bot = new Bot('test-token', {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'TestBot',
      username: 'TestBot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      can_manage_bots: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    },
  });
  const calls: CapturedCall[] = [];

  bot.api.config.use(async (prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'sendMessage') {
      return {
        ok: true,
        result: { message_id: 1, chat: { id: 1 }, date: 0, text: '' },
      } as unknown as ReturnType<typeof prev>;
    }
    return { ok: true, result: true } as unknown as ReturnType<typeof prev>;
  });

  return { bot, calls };
}

function makeUpdate(userId: number, text: string) {
  const commandLength = text.split(' ')[0].length;
  return {
    update_id: userId,
    message: {
      message_id: 1,
      chat: { id: userId, type: 'private' as const, first_name: 'User' },
      from: {
        id: userId,
        is_bot: false,
        first_name: 'User',
        language_code: 'en',
      },
      date: 0,
      text,
      entities: [{ type: 'bot_command' as const, offset: 0, length: commandLength }],
    },
  };
}

function replyMarkup(payload: Record<string, unknown>): ReplyMarkup {
  const markup = payload['reply_markup'];
  if (!markup || typeof markup !== 'object') return {};
  return markup as ReplyMarkup;
}

describe('bot command handlers', () => {
  it('/play replies with a URL button for the configured game URL', async () => {
    const { bot, calls } = createTestBot();
    const webAppUrl = 'https://example.com/game';
    bot.command('play', makePlayHandler({ webAppUrl }));

    await bot.handleUpdate(makeUpdate(101, '/play'));

    const sendMessage = calls.find((call) => call.method === 'sendMessage');
    expect(sendMessage).toBeDefined();
    const keyboard = replyMarkup(sendMessage!.payload).inline_keyboard;
    expect(keyboard?.[0]?.[0]?.['url']).toBe(webAppUrl);
    expect(keyboard?.[0]?.[0]?.['web_app']).toBeUndefined();
  });

  it('/rules replies with the existing rules text in Markdown', async () => {
    const { bot, calls } = createTestBot();
    bot.command('rules', makeHelpHandler());

    await bot.handleUpdate(makeUpdate(102, '/rules'));

    const sendMessage = calls.find((call) => call.method === 'sendMessage');
    expect(sendMessage).toBeDefined();
    expect(sendMessage!.payload['text']).toBe(t('en', 'help'));
    expect(sendMessage!.payload['parse_mode']).toBe('Markdown');
  });
});
