/**
 * Event type constants for the abilities-playground.
 * Using constants prevents typos and keeps systems decoupled.
 */
export const GameEvents = {
  PROJECTILE_DESPAWN_REQUESTED: 'combat:projectileDespawnRequested',
} as const;

export type GameEventType = (typeof GameEvents)[keyof typeof GameEvents];

export type ProjectileDespawnRequestedEvent = {
  projectileId: number;
  dueTick: number;
};

