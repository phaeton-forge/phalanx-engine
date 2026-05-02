import { describe, it, expect } from 'vitest';
import { Bot } from 'grammy';
import { makeFriendsHandler } from '../../src/bot/handlers/friends.js';

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
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      chat: { id: userId, type: 'private' as const, first_name: 'User' },
      from: {
        id: userId,
        is_bot: false,
        first_name: 'User',
        username: 'user_name',
        language_code: 'en',
      },
      date: Math.floor(Date.now() / 1000),
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

describe('/friends handler', () => {
  it('creates a private room and sends share/copy room link actions', async () => {
    const { bot, calls } = createTestBot();
    const requests: Array<{ playerId: string; username?: string }> = [];

    bot.command(
      'friends',
      makeFriendsHandler({
        botUsername: 'TestBot',
        telegramAppName: 'play',
        webAppUrl: 'https://example.com/app',
        createPrivateRoom: (request: { playerId: string; username?: string }) => {
          requests.push(request);
          return { code: 'ABC123' };
        },
      }),
    );

    await bot.handleUpdate(makeUpdate(100, '/friends'));

    expect(requests).toEqual([{ playerId: 'telegram:100', username: 'user_name' }]);

    const sendMessage = calls.find((call) => call.method === 'sendMessage');
    expect(sendMessage).toBeDefined();
    expect(sendMessage!.payload['text']).toContain(
      'https://t.me/TestBot/play?startapp=ABC123',
    );
    expect(sendMessage!.payload['text']).not.toContain('ref_100');

    const keyboard = replyMarkup(sendMessage!.payload).inline_keyboard;
    expect(keyboard).toBeDefined();
    expect(keyboard?.[0]?.[0]?.['url']).toBe(
      'https://t.me/TestBot/play?startapp=ABC123',
    );
    expect(keyboard?.[1]?.[0]?.['url']).toContain('https://t.me/share/url?');
    expect(keyboard?.[2]?.[0]?.['copy_text']).toEqual({
      text: 'https://t.me/TestBot/play?startapp=ABC123',
    });
  });
});


