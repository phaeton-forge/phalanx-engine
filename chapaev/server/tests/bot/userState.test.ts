import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  clearUserState,
  ensureUserStateTable,
  getUserState,
  setUserState,
} from '../../src/bot/userState.js';

function buildDb(): Database.Database {
  return new Database(':memory:');
}

describe('userState', () => {
  it('creates the table and returns idle for missing users', () => {
    const db = buildDb();

    ensureUserStateTable(db);

    expect(getUserState(db, 100)).toEqual({ state: 'idle', category: null });
  });

  it('sets, updates, and clears user state', () => {
    const db = buildDb();

    setUserState(db, 100, 'awaiting_category');
    expect(getUserState(db, 100)).toEqual({
      state: 'awaiting_category',
      category: null,
    });

    setUserState(db, 100, 'awaiting_feedback', 'bug');
    expect(getUserState(db, 100)).toEqual({
      state: 'awaiting_feedback',
      category: 'bug',
    });

    clearUserState(db, 100);
    expect(getUserState(db, 100)).toEqual({ state: 'idle', category: null });
  });
});
