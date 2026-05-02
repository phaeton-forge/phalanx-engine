import type Database from 'better-sqlite3';

export interface Player {
  id: string;
  display_name: string | null;
  created_at: number;
}

export function ensurePlayer(
  db: Database.Database,
  id: string,
  displayName?: string,
): Player {
  const existing = db
    .prepare<[string], Player>('SELECT * FROM players WHERE id = ?')
    .get(id);
  if (existing) return existing;

  db.prepare(
    'INSERT INTO players (id, display_name) VALUES (?, ?)',
  ).run(id, displayName ?? null);

  return db
    .prepare<[string], Player>('SELECT * FROM players WHERE id = ?')
    .get(id)!;
}
