import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../config.js';
import { createBot } from '../bot/index.js';
import { applyBotSettings } from '../bot/setup.js';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(SERVER_DIR, '../../.env') });

async function main() {
  const config = parseConfig();
  if (!config.BOT_ENABLED) {
    console.error('BOT_ENABLED is false — nothing to set up.');
    process.exit(1);
  }

  const bot = createBot(config.TELEGRAM_BOT_TOKEN!);
  await applyBotSettings(bot);
  console.log('Bot settings applied successfully.');
}

void main().catch((err) => {
  console.error('bot:setup failed:', err);
  process.exit(1);
});
