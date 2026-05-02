import type { Bot } from 'grammy';

export async function applyBotSettings(
  bot: Bot,
  webAppUrl: string,
): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Start the bot / get welcome message' },
    { command: 'play', description: 'Launch the game' },
    { command: 'friends', description: 'Invite friends' },
    { command: 'help', description: 'Show game rules' },
  ]);

  await bot.api.setMyDescription('Chapaev — the classic board game as a Mini App.');
  await bot.api.setMyShortDescription('Play Chapaev right in Telegram!');
  await bot.api.setChatMenuButton({
    menu_button: { type: 'web_app', text: '🎮 Play', web_app: { url: webAppUrl } },
  });
}
