import type Database from 'better-sqlite3';
import { ensurePlayer } from './players.js';

export interface TelegramUser {
  telegram_id: number;
  player_id: string;
  username: string | null;
  first_name: string | null;
  language_code: string | null;
  referred_by: number | null;
  first_seen_at: number;
  last_seen_at: number;
}

export interface GetOrCreateResult {
  user: TelegramUser;
  isNew: boolean;
}

export function getOrCreateTelegramUser(
  db: Database.Database,
  params: {
    telegramId: number;
    username?: string;
    firstName?: string;
    languageCode?: string;
    referredBy?: number;
  },
): GetOrCreateResult {
  return db.transaction(() => {
    const existing = db
      .prepare<[number], TelegramUser>(
        'SELECT * FROM telegram_users WHERE telegram_id = ?',
      )
      .get(params.telegramId);

    if (existing) {
      db.prepare(
        `UPDATE telegram_users
         SET username = ?, first_name = ?, language_code = ?, last_seen_at = unixepoch()
         WHERE telegram_id = ?`,
      ).run(
        params.username ?? null,
        params.firstName ?? null,
        params.languageCode ?? null,
        params.telegramId,
      );
      const updated = db
        .prepare<[number], TelegramUser>(
          'SELECT * FROM telegram_users WHERE telegram_id = ?',
        )
        .get(params.telegramId)!;
      return { user: updated, isNew: false };
    }

    const playerId = `tg_${params.telegramId}`;
    ensurePlayer(db, playerId, params.firstName ?? params.username);

    let referredBy: number | null = null;
    if (
      params.referredBy != null &&
      params.referredBy !== params.telegramId
    ) {
      const referrer = db
        .prepare<[number], { telegram_id: number }>(
          'SELECT telegram_id FROM telegram_users WHERE telegram_id = ?',
        )
        .get(params.referredBy);
      if (referrer) referredBy = params.referredBy;
    }

    db.prepare(
      `INSERT INTO telegram_users
         (telegram_id, player_id, username, first_name, language_code, referred_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      params.telegramId,
      playerId,
      params.username ?? null,
      params.firstName ?? null,
      params.languageCode ?? null,
      referredBy,
    );

    const created = db
      .prepare<[number], TelegramUser>(
        'SELECT * FROM telegram_users WHERE telegram_id = ?',
      )
      .get(params.telegramId)!;
    return { user: created, isNew: true };
  })() as GetOrCreateResult;
}

export function recordReferral(
  db: Database.Database,
  telegramId: number,
  referrerId: number,
): void {
  if (telegramId === referrerId) return;
  db.transaction(() => {
    const user = db
      .prepare<[number], TelegramUser>(
        'SELECT * FROM telegram_users WHERE telegram_id = ?',
      )
      .get(telegramId);
    if (!user || user.referred_by != null) return;

    const referrer = db
      .prepare<[number], { telegram_id: number }>(
        'SELECT telegram_id FROM telegram_users WHERE telegram_id = ?',
      )
      .get(referrerId);
    if (!referrer) return;

    db.prepare(
      'UPDATE telegram_users SET referred_by = ? WHERE telegram_id = ?',
    ).run(referrerId, telegramId);
  })();
}
