import { isBotPlayerId, SYSTEM_PLAYER_ID } from '@phalanx-engine/runtime';

/**
 * `system` and `bot:<slot>` are produced by the server sim. A client
 * cannot join, recover, or occupy a human slot under either id.
 */
export function reservedPlayerMessage(playerId: string): string | null {
  if (playerId === SYSTEM_PLAYER_ID || isBotPlayerId(playerId)) {
    return `player id '${playerId}' is reserved`;
  }
  return null;
}
