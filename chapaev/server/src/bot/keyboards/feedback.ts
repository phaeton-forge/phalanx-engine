import { InlineKeyboard } from 'grammy';
import type { Lang } from '../i18n.js';
import { t } from '../i18n.js';

export function textGateKeyboard(lang: Lang, webAppUrl: string): InlineKeyboard {
  return new InlineKeyboard()
    .webApp(t(lang, 'btnPlay'), webAppUrl)
    .row()
    .text(t(lang, 'btnFeedback'), 'feedback_start');
}

export function feedbackCategoryKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'btnFeedbackBug'), 'feedback_bug')
    .row()
    .text(t(lang, 'btnFeedbackIdea'), 'feedback_idea')
    .row()
    .text(t(lang, 'btnFeedbackReview'), 'feedback_review')
    .row()
    .text(t(lang, 'btnCancel'), 'feedback_cancel');
}
