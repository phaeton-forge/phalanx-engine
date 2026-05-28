/** Server URL — override with VITE_SERVER_URL for deployed clients. */
export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

/** Must match the Phalanx server tickRate. */
export const networkConfig = {
  tickRate: 20,
  tickTimestep: 1 / 20,
};

/** World units per second for projectile forward travel. */
export const PROJECTILE_SPEED = 120;

export const physicsConfig = {
  subSteps: 3,
  gridCellSize: 8,
  /**
   * Physics clamps every body's velocity magnitude to this value during integration.
   * Must be >= {@link PROJECTILE_SPEED} or projectiles will not reach their configured speed.
   */
  maxVelocity: Math.max(PROJECTILE_SPEED, 18),
  pushStrength: 12,
};

/** Seconds before an active projectile is returned to the pool. */
export const PROJECTILE_LIFETIME_SECONDS = 3;

/** Delay after impact before projectile entity is removed (keeps transform readable for cues). */
export const PROJECTILE_DESPAWN_DELAY_TICKS = 20;

export const pauseConfig = {
  maxPausesPerPlayer: 3,
  requireSamePlayerToResume: true,
};

export const cameraConfig = {
  height: 70,
  lookAheadOffset: 52,
  moveSpeed: 90,
  edgeScrollMargin: 24,
  boundsPadding: 20,
  minHeight: 35,
  maxHeight: 140,
  zoomSensitivity: 0.08,
};

/** Distance from each end of the arena (along Z) to the team spawn line. */
export const arenaSpawnInset = 20;

const arenaLength = 200;

export const arenaParams = {
  width: 60,
  length: arenaLength,
  team1SpawnZ: -arenaLength / 2 + arenaSpawnInset,
  team2SpawnZ: arenaLength / 2 - arenaSpawnInset,
  team1Color: '#3366FF',
  team2Color: '#FF3333',
  groundColor: '#2d3436',
  centerLineColor: '#f5f6fa',
};
