/** Version of the engine-owned snapshot wrapper (header + body + bot state). */
export const ENGINE_SNAPSHOT_FORMAT = 1;

/** First four bytes of every snapshot produced by the runtime. */
export const SNAPSHOT_MAGIC = 'PHXS';

/** Version of {@link ReplayRecord}. */
export const REPLAY_FORMAT = 1;

/** Server-mode periodic snapshot interval (persistence only, not catch-up). */
export const DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS = 1000;

/** Client-mode periodic snapshot interval (IndexedDB resume). */
export const DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS = 300;

/** How often a runner computes and publishes its state digest. */
export const DEFAULT_HASH_EVERY_TICKS = 60;

/** Default delay between a decision at tick T and its execution tick. */
export const DEFAULT_INPUT_DELAY_TICKS = 2;

/** Player-id prefix used for bot slots in command batches (`bot:<slot>`). */
export const BOT_PLAYER_ID_PREFIX = 'bot:';

/** Canonical player id of a bot slot inside a `CommandsBatch`. */
export function botPlayerId(slot: number): string {
  if (!Number.isInteger(slot) || slot < 0) {
    throw new Error(
      `botPlayerId: slot must be a non-negative integer, got ${String(slot)}`
    );
  }
  return `${BOT_PLAYER_ID_PREFIX}${slot}`;
}

/** True when `playerId` names a bot slot (`bot:<slot>`). */
export function isBotPlayerId(playerId: string): boolean {
  return /^bot:(0|[1-9][0-9]*)$/.test(playerId);
}
