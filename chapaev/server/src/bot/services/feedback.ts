import type { Bot } from 'grammy';
import type { Logger } from '../../log.js';

export async function deliverFeedback(
  bot: Pick<Bot, 'api'>,
  feedbackChatId: number,
  log: Logger,
  userId: number,
  username: string | undefined,
  category: string,
  text: string,
): Promise<void> {
  const displayUsername = username ? `@${username}` : '—';
  const message = `[${category}] от ${displayUsername} (id=${userId})\n${text}`;

  // TODO: replace with a feedback(id, user_id, username, category, text, created_at) table.
  try {
    await bot.api.sendMessage(feedbackChatId, message);
  } catch (err) {
    log.error({ err }, 'feedback delivery failed');
  }
}
