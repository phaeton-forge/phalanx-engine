/**
 * Generates a display name that mimics PhalanxClient's default guest style:
 * `Player-${lastSixOfPlayerId}` — here we use six random alphanumerics.
 */
export function generateBotOpponentDisplayName(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `Player-${suffix}`;
}
