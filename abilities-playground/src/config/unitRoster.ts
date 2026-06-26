import {
  HEAL_AURA_RADIUS,
  HEAL_PER_PULSE,
  HEAL_PULSE_TICKS,
  ROCKET_DETECTION_RANGE,
  ROCKET_MAX_HEALTH,
  ROCKET_STOP_RANGE,
} from './abilityDefinitions';

export type UnitKind = 'sphere' | 'cube' | 'support' | 'rocket';

/** Default hostile detection radius (world units); matches gameplay and debug ring. */
export const DEFAULT_UNIT_DETECTION_RANGE = 25;

export interface UnitSpawnOffset {
  readonly offsetX: number;
  readonly offsetZ: number;
}

export interface UnitRosterEntry {
  readonly kind: UnitKind;
  /**
   * Spawn offsets per team.
   * If a team is omitted, that unit does not spawn for that team.
   */
  readonly spawns: Readonly<Partial<Record<0 | 1, UnitSpawnOffset>>>;
  readonly radius: number;
  readonly mass: number;
  readonly stopRange: number;
  readonly maxHealth: number;
  /** Hostile detection radius; defaults to {@link DEFAULT_UNIT_DETECTION_RANGE}. */
  readonly detectionRange?: number;
  /** Healing aura radius (world units). Only meaningful for `support` units. */
  readonly auraRadius?: number;
  /** Healing applied to each ally per aura pulse. Only for `support` units. */
  readonly healPerPulse?: number;
  /** Ticks between aura pulses. Only for `support` units. */
  readonly healPulseTicks?: number;
}

const BLUE_TEAM_SPHERES = 10;
const RED_TEAM_SPHERES = 24;

// Keep in sync with UnitFactory sphere mesh size (world units).
const SPHERE_RADIUS = 2;
const SPHERE_MASS = 2;
const SPHERE_STOP_RANGE = 18;
const SPHERE_MAX_HEALTH = 100;

function lcg01(seed: number): number {
  // Deterministic PRNG for formation jitter (no runtime randomness).
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
}

function makeFormation(
  count: number,
  opts: {
    cols: number;
    spacingX: number;
    spacingZ: number;
    startZ: number;
    /** Per-row X shift to break symmetry. */
    rowSkewX: number;
    /** Alternating per-row X offset ("stagger"). */
    rowStaggerX: number;
    /** Max random-ish jitter per unit (world units). */
    jitter: number;
    seed: number;
  },
): UnitSpawnOffset[] {
  const cols = Math.max(1, Math.floor(opts.cols));

  const spawns: UnitSpawnOffset[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const centeredCol = col - (cols - 1) / 2;

    const stagger = (row % 2 === 0 ? 1 : -1) * opts.rowStaggerX;
    const skew = row * opts.rowSkewX;

    const r1 = lcg01(opts.seed ^ (i * 2654435761));
    const r2 = lcg01(opts.seed ^ (i * 1597334677 + 101));
    const jx = (r1 * 2 - 1) * opts.jitter;
    const jz = (r2 * 2 - 1) * opts.jitter;

    spawns.push({
      offsetX: centeredCol * opts.spacingX + stagger + skew + jx,
      offsetZ: opts.startZ + row * opts.spacingZ + jz,
    });
  }
  return spawns;
}

// Spacing scaled for arena width 90 (×1.5 vs original 60). Sphere diameter = 4.
const blueSpawns = makeFormation(BLUE_TEAM_SPHERES, {
  cols: 5,
  spacingX: 10,
  spacingZ: 6.5,
  startZ: 6,
  rowSkewX: 0.35,
  rowStaggerX: 1.1,
  jitter: 0.5,
  seed: 0xB10E,
});

const redSpawns = makeFormation(RED_TEAM_SPHERES, {
  cols: 5,
  spacingX: 9.5,
  spacingZ: 7,
  startZ: 5,
  rowSkewX: -0.45,
  rowStaggerX: 0.9,
  jitter: 0.5,
  seed: 0x52ED,
});

// it sits inside the friendly cluster (aura covers nearby allies).
const SUPPORT_RADIUS = 2;
const SUPPORT_MASS = 3;
const SUPPORT_MAX_HEALTH = 70;

// Keep in sync with UnitFactory cube mesh size (BoxGeometry 5 => half-extent 2.5).
const CUBE_RADIUS = 2.5;
const CUBE_MASS = 3;
const CUBE_STOP_RANGE = 24;
const CUBE_MAX_HEALTH = 120;
const CUBE_DETECTION_RANGE = 32;

const CUBE_ROSTER: readonly UnitRosterEntry[] = [
  {
    kind: 'cube',
    spawns: {
      0: { offsetX: -9, offsetZ: -5 },
      1: { offsetX: 6, offsetZ: -5 },
    },
    radius: CUBE_RADIUS,
    mass: CUBE_MASS,
    stopRange: CUBE_STOP_RANGE,
    maxHealth: CUBE_MAX_HEALTH,
    detectionRange: CUBE_DETECTION_RANGE,
  },
  {
    kind: 'cube',
    spawns: { 0: { offsetX: 9, offsetZ: -6 } },
    radius: CUBE_RADIUS,
    mass: CUBE_MASS,
    stopRange: CUBE_STOP_RANGE,
    maxHealth: CUBE_MAX_HEALTH,
    detectionRange: CUBE_DETECTION_RANGE,
  },
  {
    kind: 'cube',
    spawns: { 0: { offsetX: 0, offsetZ: -5 } },
    radius: CUBE_RADIUS,
    mass: CUBE_MASS,
    stopRange: CUBE_STOP_RANGE,
    maxHealth: CUBE_MAX_HEALTH,
    detectionRange: CUBE_DETECTION_RANGE,
  },
  {
    kind: 'cube',
    spawns: { 1: { offsetX: -9, offsetZ: -5 } },
    radius: CUBE_RADIUS,
    mass: CUBE_MASS,
    stopRange: CUBE_STOP_RANGE,
    maxHealth: CUBE_MAX_HEALTH,
    detectionRange: CUBE_DETECTION_RANGE,
  },
];

const SUPPORT_ROSTER: readonly UnitRosterEntry[] = [
  {
    kind: 'support',
    // Blue center rear — aura covers the wider 5×5 sphere block.
    spawns: { 0: { offsetX: 0, offsetZ: 2 } },
    radius: SUPPORT_RADIUS,
    mass: SUPPORT_MASS,
    stopRange: 22,
    maxHealth: SUPPORT_MAX_HEALTH,
    auraRadius: HEAL_AURA_RADIUS,
    healPerPulse: HEAL_PER_PULSE,
    healPulseTicks: HEAL_PULSE_TICKS,
  },
  {
    kind: 'support',
    // Red left flank — scaled with wider arena; aura still reaches the front line.
    spawns: { 1: { offsetX: -20, offsetZ: 1 } },
    radius: SUPPORT_RADIUS,
    mass: SUPPORT_MASS,
    stopRange: 22,
    maxHealth: SUPPORT_MAX_HEALTH,
    auraRadius: HEAL_AURA_RADIUS,
    healPerPulse: HEAL_PER_PULSE,
    healPulseTicks: HEAL_PULSE_TICKS,
  },
  {
    kind: 'support',
    // Red right flank — ~40 world units apart so auras overlap in the center.
    spawns: { 1: { offsetX: 20, offsetZ: 1 } },
    radius: SUPPORT_RADIUS,
    mass: SUPPORT_MASS,
    stopRange: 22,
    maxHealth: SUPPORT_MAX_HEALTH,
    auraRadius: HEAL_AURA_RADIUS,
    healPerPulse: HEAL_PER_PULSE,
    healPulseTicks: HEAL_PULSE_TICKS,
  },
  {
    kind: 'support',
    // Red center rear — auras overlap with the flank pair.
    spawns: { 1: { offsetX: 0, offsetZ: 2 } },
    radius: SUPPORT_RADIUS,
    mass: SUPPORT_MASS,
    stopRange: 22,
    maxHealth: SUPPORT_MAX_HEALTH,
    auraRadius: HEAL_AURA_RADIUS,
    healPerPulse: HEAL_PER_PULSE,
    healPulseTicks: HEAL_PULSE_TICKS,
  },
];

const ROCKET_RADIUS = 2.5;
const ROCKET_MASS = 3;

const ROCKET_ROSTER: readonly UnitRosterEntry[] = [
  {
    kind: 'rocket',
    spawns: {
      0: { offsetX: -15, offsetZ: -8 },
      1: { offsetX: 15, offsetZ: -8 },
    },
    radius: ROCKET_RADIUS,
    mass: ROCKET_MASS,
    stopRange: ROCKET_STOP_RANGE,
    maxHealth: ROCKET_MAX_HEALTH,
    detectionRange: ROCKET_DETECTION_RANGE,
  },
  {
    kind: 'rocket',
    spawns: {
      0: { offsetX: 15, offsetZ: -8 },
      1: { offsetX: -15, offsetZ: -8 },
    },
    radius: ROCKET_RADIUS,
    mass: ROCKET_MASS,
    stopRange: ROCKET_STOP_RANGE,
    maxHealth: ROCKET_MAX_HEALTH,
    detectionRange: ROCKET_DETECTION_RANGE,
  },
];

export const UNIT_ROSTER: readonly UnitRosterEntry[] = Array.from(
  { length: Math.max(BLUE_TEAM_SPHERES, RED_TEAM_SPHERES) },
  (_unused, i): UnitRosterEntry => ({
    kind: 'sphere',
    spawns: {
      ...(i < BLUE_TEAM_SPHERES ? { 0: blueSpawns[i] } : {}),
      ...(i < RED_TEAM_SPHERES ? { 1: redSpawns[i] } : {}),
    },
    radius: SPHERE_RADIUS,
    mass: SPHERE_MASS,
    stopRange: SPHERE_STOP_RANGE,
    maxHealth: SPHERE_MAX_HEALTH,
  }),
).concat(CUBE_ROSTER, SUPPORT_ROSTER, ROCKET_ROSTER);
