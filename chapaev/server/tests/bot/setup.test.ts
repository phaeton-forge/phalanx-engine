import { describe, expect, it } from 'vitest';
import { Bot } from 'grammy';
import { applyBotSettings } from '../../src/bot/setup.js';

interface CapturedCall {
  method: string;
  payload: Record<string, unknown>;
}

interface BotCommand {
  command: string;
  description: string;
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
    return { ok: true, result: true } as unknown as ReturnType<typeof prev>;
  });

  return { bot, calls };
}

describe('applyBotSettings', () => {
  it('registers the public command menu and uses the global commands button', async () => {
    const { bot, calls } = createTestBot();

    await applyBotSettings(bot);

    const commandsCall = calls.find((call) => call.method === 'setMyCommands');
    expect(commandsCall).toBeDefined();
    expect(commandsCall!.payload).toEqual({
      commands: [
        { command: 'play', description: 'Играть' },
        { command: 'feedback', description: '✉️ Оставить отзыв' },
        { command: 'invite', description: 'Пригласить друга в игру' },
        { command: 'rules', description: 'Правила игры' },
      ],
    });

    const commands = commandsCall!.payload['commands'] as BotCommand[];
    expect(commands.map((command) => command.command)).not.toContain('friends');

    const menuButtonCall = calls.find((call) => call.method === 'setChatMenuButton');
    expect(menuButtonCall).toBeDefined();
    expect(menuButtonCall!.payload).toEqual({
      menu_button: { type: 'commands' },
    });
  });
});
