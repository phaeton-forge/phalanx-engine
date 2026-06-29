/**
 * Event type constants for the abilities-playground.
 * Using constants prevents typos and keeps systems decoupled.
 */
export const GameEvents = {
  PROJECTILE_DESPAWN_REQUESTED: 'combat:projectileDespawnRequested',
  CHAIN_LIGHTNING_JUMP_QUEUED: 'combat:chainLightningJumpQueued',
} as const;

export type GameEventType = (typeof GameEvents)[keyof typeof GameEvents];

export type ProjectileDespawnRequestedEvent = {
  projectileId: number;
  dueTick: number;
};

export type ChainLightningJumpQueuedEvent = {
  /** Simulation tick on which this jump should be applied. */
  dueTick: number;
  /** Entity receiving the damage effect. */
  targetId: number;
  /** Effect id to apply (primary or jump variant). */
  effectId: string;
  /** Entity the lightning bolt should originate from. */
  sourceId: number;
};
