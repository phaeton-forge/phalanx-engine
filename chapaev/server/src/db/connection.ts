import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let instance: Database.Database | null = null;

export function openDb(path: string): Database.Database {
  if (instance) return instance;

  mkdirSync(dirname(path), { recursive: true });
  instance = new Database(path);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  return instance;
}

export function getDb(): Database.Database {
  if (!instance) throw new Error('DB not opened — call openDb() first');
  return instance;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
