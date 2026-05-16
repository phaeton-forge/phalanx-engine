import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Bot } from 'grammy';
import { makeFeedbackHandlers } from '../../src/bot/handlers/feedback.js';
import { t } from '../../src/bot/i18n.js';
import { getUserState, setUserState } from '../../src/bot/userState.js';
import type { Logger } from '../../src/log.js';

interface CapturedCall {
  method: string;
  payload: Record<string, unknown>;
}

const FEEDBACK_CHAT_ID = -100;

function createTestBot(db: Database.Database): {
  bot: Bot;
  calls: CapturedCall[];
} {
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

  const log = { error: vi.fn() } as unknown as Logger;
  const handlers = makeFeedbackHandlers(db, log, FEEDBACK_CHAT_ID);
  bot.command('feedback', handlers.entryHandler);
  bot.callbackQuery('feedback_start', handlers.entryHandler);
  bot.callbackQuery(
    /^feedback_(bug|idea|review|cancel)$/,
    handlers.categoryHandler,
  );
  bot.command('cancel', handlers.cancelHandler);
  bot.on('message', handlers.messageHandler);

  return { bot, calls };
}

function commandUpdate(userId: number, text: string) {
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
        username: 'player',
        language_code: 'en',
      },
      date: 0,
      text,
      entities: [
        { type: 'bot_command' as const, offset: 0, length: commandLength },
      ],
    },
  };
}

function textUpdate(userId: number, text: string) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    message: {
      message_id: 1,
      chat: { id: userId, type: 'private' as const, first_name: 'User' },
      from: {
        id: userId,
        is_bot: false,
        first_name: 'User',
        username: 'player',
        language_code: 'en',
      },
      date: 0,
      text,
    },
  };
}

function callbackUpdate(userId: number, data: string) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000),
    callback_query: {
      id: 'callback-id',
      from: {
        id: userId,
        is_bot: false,
        first_name: 'User',
        username: 'player',
        language_code: 'en',
      },
      message: {
        message_id: 1,
        chat: { id: userId, type: 'private' as const, first_name: 'User' },
        date: 0,
      },
      chat_instance: 'chat-instance',
      data,
    },
  };
}

function sentTexts(calls: CapturedCall[]): unknown[] {
  return calls
    .filter((call) => call.method === 'sendMessage')
    .map((call) => call.payload['text']);
}

describe('feedback handlers', () => {
  it('runs the happy path and clears state after delivery', async () => {
    const db = new Database(':memory:');
    const { bot, calls } = createTestBot(db);

    await bot.handleUpdate(commandUpdate(100, '/feedback'));
    expect(getUserState(db, 100)).toEqual({
      state: 'awaiting_category',
      category: null,
    });

    await bot.handleUpdate(callbackUpdate(100, 'feedback_bug'));
    expect(getUserState(db, 100)).toEqual({
      state: 'awaiting_feedback',
      category: 'bug',
    });

    await bot.handleUpdate(textUpdate(100, 'Broken move animation'));

    expect(getUserState(db, 100)).toEqual({ state: 'idle', category: null });
    expect(sentTexts(calls)).toContain(t('en', 'feedbackThanks'));
    expect(
      calls.find(
        (call) =>
          call.method === 'sendMessage' &&
          call.payload['chat_id'] === FEEDBACK_CHAT_ID,
      )?.payload['text'],
    ).toBe('[bug] от @player (id=100)\nBroken move animation');
  });

  it('cancels from callback and command', async () => {
    const db = new Database(':memory:');
    const { bot, calls } = createTestBot(db);

    setUserState(db, 100, 'awaiting_category');
    await bot.handleUpdate(callbackUpdate(100, 'feedback_cancel'));
    expect(getUserState(db, 100)).toEqual({ state: 'idle', category: null });

    setUserState(db, 100, 'awaiting_feedback', 'idea');
    await bot.handleUpdate(commandUpdate(100, '/cancel'));
    expect(getUserState(db, 100)).toEqual({ state: 'idle', category: null });
    expect(sentTexts(calls).filter((text) => text === t('en', 'feedbackCancelled'))).toHaveLength(2);
  });

  it.each([
    ['too short', 'no'],
    ['too long', 'x'.repeat(2001)],
  ])('keeps state and prompts again for %s feedback', async (_name, text) => {
    const db = new Database(':memory:');
    const { bot, calls } = createTestBot(db);
    setUserState(db, 100, 'awaiting_feedback', 'review');

    await bot.handleUpdate(textUpdate(100, text));

    expect(getUserState(db, 100)).toEqual({
      state: 'awaiting_feedback',
      category: 'review',
    });
    expect(sentTexts(calls)).toContain(t('en', 'feedbackLengthError'));
  });

  it('restarts from category selection when /feedback is sent during a flow', async () => {
    const db = new Database(':memory:');
    const { bot, calls } = createTestBot(db);
    setUserState(db, 100, 'awaiting_feedback', 'bug');

    await bot.handleUpdate(commandUpdate(100, '/feedback'));

    expect(getUserState(db, 100)).toEqual({
      state: 'awaiting_category',
      category: null,
    });
    expect(sentTexts(calls)).toContain(t('en', 'feedbackCategoryPrompt'));
  });
});
