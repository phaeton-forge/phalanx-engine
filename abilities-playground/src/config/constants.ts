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

/** Team color palette. Colors are stored as hex numbers for Three.js. */
export interface TeamPalette {
  /** Primary team tint used for bodies, grid lines and health bars. */
  primary: number;
  /** Dark shade used for outlines, bases and shadows. */
  deep: number;
  /** Highlight used for bright edges, emissive rims and hover states. */
  highlight: number;
  /** Glow color for magical / emissive elements. */
  glow: number;
  /** Accent for auras, abilities and grid spawn line. */
  accent: number;
}

/** Blue / steel palette. */
const bluePalette: TeamPalette = {
  primary: 0x2563eb,
  deep: 0x1e3a8a,
  highlight: 0x60a5fa,
  glow: 0x93c5fd,
  accent: 0x00bfff,
};

/** Red / ember palette. */
const redPalette: TeamPalette = {
  primary: 0xdc2626,
  deep: 0x7f1d1d,
  highlight: 0xf87171,
  glow: 0xfb923c,
  accent: 0xff4500,
};

export const teamPalettes: Record<0 | 1, TeamPalette> = {
  0: bluePalette,
  1: redPalette,
};

export type TeamColorRole = keyof TeamPalette;

/** Get a team color as a Three.js hex number. */
export function getTeamColor(teamId: 0 | 1, role: TeamColorRole): number {
  return teamPalettes[teamId][role];
}

export const arenaParams = {
  width: arenaWidth,
  length: arenaLength,
  team1SpawnZ: -arenaLength / 2 + arenaSpawnInset,
  team2SpawnZ: arenaLength / 2 - arenaSpawnInset,
  team1Color: '#' + bluePalette.primary.toString(16).padStart(6, '0'),
  team2Color: '#' + redPalette.primary.toString(16).padStart(6, '0'),
  groundColor: '#4a4e57',
  centerLineColor: '#f5f6fa',
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
