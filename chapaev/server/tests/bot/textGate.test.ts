import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Bot } from 'grammy';
import { makeTextGateMiddleware } from '../../src/bot/handlers/textGate.js';
import { t } from '../../src/bot/i18n.js';
import { setUserState } from '../../src/bot/userState.js';

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

function baseMessage(userId: number) {
  return {
    message_id: 1,
    chat: { id: userId, type: 'private' as const, first_name: 'User' },
    from: {
      id: userId,
      is_bot: false,
      first_name: 'User',
      language_code: 'en',
    },
    date: 0,
  };
}

function messageUpdate(userId: number, message: Record<string, unknown>) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: { ...baseMessage(userId), ...message },
  };
}

function callbackUpdate(userId: number) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    callback_query: {
      id: 'callback-id',
      from: {
        id: userId,
        is_bot: false,
        first_name: 'User',
        language_code: 'en',
      },
      chat_instance: 'chat-instance',
      data: 'show_rules',
    },
  };
}

function replyMarkup(payload: Record<string, unknown>): ReplyMarkup {
  const markup = payload['reply_markup'];
  if (!markup || typeof markup !== 'object') return {};
  return markup as ReplyMarkup;
}

describe('textGate middleware', () => {
  it.each([
    ['text', { text: 'hello' }],
    ['sticker', { sticker: { file_id: 'sticker', file_unique_id: 'u', type: 'regular', width: 1, height: 1, is_animated: false, is_video: false } }],
    ['photo', { photo: [{ file_id: 'photo', file_unique_id: 'u', width: 1, height: 1 }] }],
  ])('blocks idle %s messages with the game/feedback template', async (_name, message) => {
    const db = new Database(':memory:');
    const { bot, calls } = createTestBot();
    let reached = false;
    bot.use(makeTextGateMiddleware(db, 'https://example.com/game'));
    bot.use(() => {
      reached = true;
    });

    await bot.handleUpdate(messageUpdate(100, message));

    expect(reached).toBe(false);
    const sendMessage = calls.find((call) => call.method === 'sendMessage');
    expect(sendMessage?.payload['text']).toBe(t('en', 'textGate'));
    expect(replyMarkup(sendMessage!.payload).inline_keyboard?.[0]?.[0]?.['web_app']).toEqual({
      url: 'https://example.com/game',
    });
  });

  it('allows messages while awaiting feedback', async () => {
    const db = new Database(':memory:');
    setUserState(db, 100, 'awaiting_feedback', 'bug');
    const { bot, calls } = createTestBot();
    let reached = false;
    bot.use(makeTextGateMiddleware(db, 'https://example.com/game'));
    bot.use(() => {
      reached = true;
    });

    await bot.handleUpdate(messageUpdate(100, { text: 'feedback text' }));

    expect(reached).toBe(true);
    expect(calls.find((call) => call.method === 'sendMessage')).toBeUndefined();
  });

  it('allows slash commands and callback queries', async () => {
    const db = new Database(':memory:');
    const { bot } = createTestBot();
    let reached = 0;
    bot.use(makeTextGateMiddleware(db, 'https://example.com/game'));
    bot.use(() => {
      reached += 1;
    });

    await bot.handleUpdate(
      messageUpdate(100, {
        text: '/feedback',
        entities: [{ type: 'bot_command' as const, offset: 0, length: 9 }],
      }),
    );
    await bot.handleUpdate(callbackUpdate(100));

    expect(reached).toBe(2);
  });
});
