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

export const MISSILE_SPEED = 70;
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
export const MISSILE_TARGETING_TURN = 0.7;
export const MISSILE_CRUISE_TURN = 0.4;
/** XZ distance from the target where a cruising missile starts its 3D dive. */
export const MISSILE_ATTACK_RANGE = 25;
/**
 * XZ distance below which the launch arc is skipped and cruise altitude scales
 * down linearly to zero (close-range shots home flat instead of looping).
 */
export const MISSILE_LAUNCH_ARC_FALLOFF = 40;
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
  team1Color: '#7FB3FF',
  team2Color: '#FF8A8A',
  groundColor: '#3a4a44',
  centerLineColor: '#f5f6fa',
  /**
   * Pastel team palettes ("Малышарики" style): one soft tint per unit type so
   * teammates are visually varied yet unmistakably warm (team2) vs cool (team1).
   * Keys match UnitType values; team1Color/team2Color above are the base/fallback.
   * Team 0 -> team1 (cool/blue), Team 1 -> team2 (warm/red).
   */
  team1Palette: {
    sphere: '#7FB3FF',
    cube: '#6FA8DC',
    support: '#8FD0E8',
    rocket: '#B6A8FF',
    volt: '#9DB8FF',
  } as Record<string, string>,
  team2Palette: {
    sphere: '#FF8A8A',
    cube: '#F2785C',
    support: '#FFB3A7',
    rocket: '#FFA37A',
    volt: '#FF9E7A',
  } as Record<string, string>,
  /**
   * Local formation grid dimensions. The grid is centered on each team's spawn line
   * (x = 0, z = team1SpawnZ / team2SpawnZ), with the depth axis pointing toward the enemy.
   * 12 × 6 cells at 6 world units each fits comfortably inside the 90-unit arena width.
   */
  formationGrid: {
    gridWidth: 12,
    gridHeight: 6,
    cellSize: 6,
    /** World units between the front edge of the formation grid and the deployed army. */
    deployGap: 10,
  },
};
