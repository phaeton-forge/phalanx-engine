CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  display_name  TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS telegram_users (
  telegram_id    INTEGER PRIMARY KEY,
  player_id      TEXT NOT NULL REFERENCES players(id),
  username       TEXT,
  first_name     TEXT,
  language_code  TEXT,
  referred_by    INTEGER REFERENCES telegram_users(telegram_id),
  first_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_player_id   ON telegram_users(player_id);
CREATE INDEX IF NOT EXISTS idx_telegram_users_referred_by ON telegram_users(referred_by);
