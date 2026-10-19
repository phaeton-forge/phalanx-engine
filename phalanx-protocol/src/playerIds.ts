/** Player id of a system command (`setController`). Not a slot. */
export const SYSTEM_PLAYER_ID = 'system';

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
