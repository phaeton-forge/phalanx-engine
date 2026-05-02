import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfig } from '../config.js';
import { openDb, closeDb } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(SERVER_DIR, '../../.env') });

const config = parseConfig(
  Object.assign({}, process.env, { BOT_ENABLED: 'false' }),
);
const MIGRATIONS_DIR = resolve(SERVER_DIR, '../../migrations');

const db = openDb(config.DATABASE_PATH);
runMigrations(db, MIGRATIONS_DIR);
closeDb();
console.log('Migrations complete.');
