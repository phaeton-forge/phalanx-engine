/** Server URL — override with VITE_SERVER_URL for deployed clients. */
export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

/** Must match the Phalanx server tickRate. */
export const networkConfig = {
  tickRate: 20,
  tickTimestep: 1 / 20,
};

/** World units per second for projectile forward travel. */
export const PROJECTILE_SPEED = 180;

/** Radians of Y rotation applied per simulation tick when turning to face a target. */
export const UNIT_TURN_SPEED_RADIANS_PER_TICK = Math.PI / 15;

/**
 * SAU (self-propelled artillery) shrapnel physics tuning.
 *
 * Gravity in phalanx-physics v1 is GLOBAL (a single PhysicsWorldConfig.gravity
 * applied by GravitySystem to every body with useGravity=true). Shrapnel is the
 * only body in the playground that opts into gravity, so we set the world's
 * global gravity to {@link SAU_SHRAPNEL_GRAVITY} and mark only shrapnel bodies
 * useGravity — no per-shrapnel gravity is faked. The shrapnel config therefore
 * carries count/cone/speed only; gravity lives here on the world config.
 */
export const SAU_SHRAPNEL_GRAVITY = 30;
/** Launch speed (world units/s) of each shrapnel fragment along its cone ray. */
export const SAU_SHRAPNEL_SPEED = 42;
/** Half-angle (radians) of the upward cone the shrapnel fragments fan out into. */
export const SAU_SHRAPNEL_CONE = Math.PI / 5;
/** Ticks between the shell being fired and its detonation (4–6 = 0.2–0.3 s @ 20 TPS). */
export const SAU_SHELL_DELAY_TICKS = 5;
/** Ground plane Y (world units) shrapnel fragments land on in v1 (no building AABBs yet). */
export const SAU_GROUND_Y = 0;

export const physicsConfig = {
  subSteps: 3,
  gridCellSize: 8,
  /**
   * Physics clamps every body's velocity magnitude to this value during integration.
   * Must be >= {@link PROJECTILE_SPEED} or projectiles will not reach their configured speed.
   */
  maxVelocity: Math.max(PROJECTILE_SPEED, 18),
  pushStrength: 12,
  /** Global downward acceleration applied to useGravity bodies (SAU shrapnel). */
  gravity: SAU_SHRAPNEL_GRAVITY,
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
 * Minimum engagement range (world units, XZ). The rocket is high-arc artillery:
 * it refuses to fire on enemies closer than this, so a missile is never spawned
 * close enough for a flat close-range shot. A missile that closes to within
 * MISSILE_ATTACK_RANGE mid-flight may still dive early; this only gates spawning.
 */
export const MISSILE_MIN_ENGAGEMENT_RANGE = 35;
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
  groundColor: '#5a6f67',
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
    plasmaTank: '#A3C9F9',
    sau: '#8FA98C',
  } as Record<string, string>,
  team2Palette: {
    sphere: '#FF8A8A',
    cube: '#F2785C',
    support: '#FFB3A7',
    rocket: '#FFA37A',
    volt: '#FF9E7A',
    plasmaTank: '#FFB08A',
    sau: '#C9A98F',
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
