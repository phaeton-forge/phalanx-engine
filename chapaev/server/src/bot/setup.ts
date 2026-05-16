import type { Bot } from 'grammy';

export async function applyBotSettings(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'play', description: '🎮 Играть' },
    { command: 'feedback', description: '✉️ Оставить отзыв' },
    { command: 'rules', description: '📖 Правила' },
    { command: 'help', description: 'ℹ️ Помощь' },
  ]);

  await bot.api.setMyDescription('Chapaev — the classic board game as a Mini App.');
  await bot.api.setMyShortDescription('Play Chapaev right in Telegram!');
  await bot.api.setChatMenuButton({
    menu_button: { type: 'commands' },
  });
}
