import type { Context } from 'grammy';
import type Database from 'better-sqlite3';
import type { Logger } from '../../log.js';
import { pickLang, t } from '../i18n.js';
import { feedbackCategoryKeyboard } from '../keyboards/feedback.js';
import { clearUserState, getUserState, setUserState } from '../userState.js';
import { deliverFeedback } from '../services/feedback.js';

const MIN_FEEDBACK_LENGTH = 3;
const MAX_FEEDBACK_LENGTH = 2000;

type FeedbackCategory = 'bug' | 'idea' | 'review';

function getFeedbackCategory(ctx: Context): FeedbackCategory | 'cancel' | null {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith('feedback_')) return null;

  const category = data.slice('feedback_'.length);
  if (
    category === 'bug' ||
    category === 'idea' ||
    category === 'review' ||
    category === 'cancel'
  ) {
    return category;
  }

  return null;
}

export function makeFeedbackHandlers(
  db: Database.Database,
  log: Logger,
  feedbackChatId: number,
): {
  entryHandler: (ctx: Context) => Promise<void>;
  categoryHandler: (ctx: Context) => Promise<void>;
  messageHandler: (ctx: Context) => Promise<void>;
  cancelHandler: (ctx: Context) => Promise<void>;
} {
  const entryHandler = async (ctx: Context): Promise<void> => {
    const from = ctx.from;
    if (!from) return;

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }

    setUserState(db, from.id, 'awaiting_category');
    const lang = pickLang(from.language_code);
    await ctx.reply(t(lang, 'feedbackCategoryPrompt'), {
      reply_markup: feedbackCategoryKeyboard(lang),
    });
  };

  const cancelHandler = async (ctx: Context): Promise<void> => {
    const from = ctx.from;
    if (!from) return;

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }

    clearUserState(db, from.id);
    const lang = pickLang(from.language_code);
    await ctx.reply(t(lang, 'feedbackCancelled'));
  };

  const categoryHandler = async (ctx: Context): Promise<void> => {
    const from = ctx.from;
    if (!from) return;

    const category = getFeedbackCategory(ctx);
    if (category === 'cancel') {
      await cancelHandler(ctx);
      return;
    }
    if (!category) return;

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }

    setUserState(db, from.id, 'awaiting_feedback', category);
    const lang = pickLang(from.language_code);
    await ctx.reply(t(lang, 'feedbackMessagePrompt'));
  };

  const messageHandler = async (ctx: Context): Promise<void> => {
    const from = ctx.from;
    if (!from) return;

    const userState = getUserState(db, from.id);
    if (userState.state !== 'awaiting_feedback') return;

    const lang = pickLang(from.language_code);
    const text = ctx.message?.text?.trim() ?? '';

    if (
      text.length < MIN_FEEDBACK_LENGTH ||
      text.length > MAX_FEEDBACK_LENGTH
    ) {
      await ctx.reply(t(lang, 'feedbackLengthError'));
      return;
    }

    await deliverFeedback(
      { api: ctx.api },
      feedbackChatId,
      log,
      from.id,
      from.username,
      userState.category ?? 'unknown',
      text,
    );
    clearUserState(db, from.id);
    await ctx.reply(t(lang, 'feedbackThanks'));
  };

  return { entryHandler, categoryHandler, messageHandler, cancelHandler };
}
