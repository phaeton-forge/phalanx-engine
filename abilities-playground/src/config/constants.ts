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

/** Radians of Y rotation applied per simulation tick when turning to face a target. */
export const UNIT_TURN_SPEED_RADIANS_PER_TICK = Math.PI / 15;

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

export const MISSILE_SPEED = 60;
export const MISSILE_LIFETIME_SECONDS = 4;
export const MISSILE_LAUNCH_TICKS = 10;
/**
 * Altitude (world units) the missile gains above its spawn Y during launch and
 * then holds for the rest of its flight. Kept well above unit height (tallest
 * unit tops out at ~6) so missiles visibly cruise over the formation instead of
 * scraping allied units.
 */
export const MISSILE_LAUNCH_HEIGHT = 10;
/** Max horizontal offset (world units) reached at the end of the launch arc. */
export const MISSILE_LAUNCH_SPREAD_MAX = 6;
export const MISSILE_TARGETING_TICKS = 14;
export const MISSILE_TARGETING_TURN = 0.15;
export const MISSILE_CRUISE_TURN = 0.4;
/** XZ distance from the target where a cruising missile starts its 3D dive. */
export const MISSILE_ATTACK_RANGE = 22;
export const MISSILE_RADIUS = 0.6;
/**
 * Radius (world units) around a missile used to search for a new hostile target
 * when its current target is destroyed mid-flight. Matches the rocket's sensor
 * range so a missile that loses its lock can reliably re-acquire a nearby enemy.
 */
export const MISSILE_RETARGET_RANGE = 70;

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
/** Playable width along X (was 60; ×1.5 for wider formations). */
const arenaWidth = 90;

export const arenaParams = {
  width: arenaWidth,
  length: arenaLength,
  team1SpawnZ: -arenaLength / 2 + arenaSpawnInset,
  team2SpawnZ: arenaLength / 2 - arenaSpawnInset,
  team1Color: '#3366FF',
  team2Color: '#FF3333',
  groundColor: '#2d3436',
  centerLineColor: '#f5f6fa',
};
