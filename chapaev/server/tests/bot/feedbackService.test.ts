import { describe, expect, it, vi } from 'vitest';
import type { Bot } from 'grammy';
import { deliverFeedback } from '../../src/bot/services/feedback.js';
import type { Logger } from '../../src/log.js';

function makeLog(): Logger {
  return {
    error: vi.fn(),
  } as unknown as Logger;
}

describe('deliverFeedback', () => {
  it('sends formatted feedback to the configured chat', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const bot = { api: { sendMessage } } as unknown as Bot;
    const log = makeLog();

    await deliverFeedback(
      bot,
      -100,
      log,
      123,
      'player',
      'bug',
      'Something is broken',
    );

    expect(sendMessage).toHaveBeenCalledWith(
      -100,
      '[bug] от @player (id=123)\nSomething is broken',
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs delivery errors without throwing', async () => {
    const err = new Error('telegram unavailable');
    const sendMessage = vi.fn().mockRejectedValue(err);
    const bot = { api: { sendMessage } } as unknown as Bot;
    const log = makeLog();

    await expect(
      deliverFeedback(bot, -100, log, 123, undefined, 'idea', 'New mode'),
    ).resolves.toBeUndefined();

    expect(log.error).toHaveBeenCalledWith(
      { err },
      'feedback delivery failed',
    );
  });
});
