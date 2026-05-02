import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { log } from '../log.js';

export function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  const applied = new Set(
    db
      .prepare<[], { filename: string }>('SELECT filename FROM _migrations')
      .all()
      .map((r) => r.filename),
  );

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // Run each migration inside a transaction so a partial failure leaves
    // the database in the state it was in before the file was attempted,
    // and the _migrations record is only written on full success.
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(file);
    })();
    log.info({ migration: file }, 'migration applied');
  }
}
