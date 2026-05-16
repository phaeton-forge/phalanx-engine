import type Database from 'better-sqlite3';

export interface UserState {
  state: string;
  category: string | null;
}

export function ensureUserStateTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_state (
      user_id    INTEGER PRIMARY KEY,
      state      TEXT    NOT NULL DEFAULT 'idle',
      category   TEXT,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function getUserState(
  db: Database.Database,
  userId: number,
): UserState {
  ensureUserStateTable(db);

  const row = db
    .prepare('SELECT state, category FROM user_state WHERE user_id = ?')
    .get(userId) as UserState | undefined;

  return row ?? { state: 'idle', category: null };
}

export function setUserState(
  db: Database.Database,
  userId: number,
  state: string,
  category?: string,
): void {
  ensureUserStateTable(db);

  db.prepare(
    `
      INSERT INTO user_state (user_id, state, category, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        state = excluded.state,
        category = excluded.category,
        updated_at = excluded.updated_at
    `,
  ).run(userId, state, category ?? null, Math.floor(Date.now() / 1000));
}

export function clearUserState(db: Database.Database, userId: number): void {
  ensureUserStateTable(db);

  db.prepare('DELETE FROM user_state WHERE user_id = ?').run(userId);
}
