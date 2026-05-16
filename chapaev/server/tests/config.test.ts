import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_APP_URL, parseConfig } from '../src/config.js';

describe('parseConfig', () => {
  it('defaults Telegram Play buttons to the production game URL', () => {
    const config = parseConfig({});

    expect(config.WEB_APP_URL).toBe(DEFAULT_WEB_APP_URL);
  });

  it('requires FEEDBACK_CHAT_ID when the bot is enabled', () => {
    expect(() =>
      parseConfig({
        BOT_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: 'token',
        TELEGRAM_WEBHOOK_SECRET: '1234567890123456',
        PUBLIC_URL: 'https://example.com',
        BOT_USERNAME: 'TestBot',
      }),
    ).toThrow('FEEDBACK_CHAT_ID required when BOT_ENABLED=true');
  });

  it('parses FEEDBACK_CHAT_ID as a number', () => {
    const config = parseConfig({
      BOT_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: 'token',
      TELEGRAM_WEBHOOK_SECRET: '1234567890123456',
      PUBLIC_URL: 'https://example.com',
      BOT_USERNAME: 'TestBot',
      FEEDBACK_CHAT_ID: '-100',
    });

    expect(config.FEEDBACK_CHAT_ID).toBe(-100);
  });
});
