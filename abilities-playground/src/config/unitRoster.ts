export type UnitKind = 'sphere' | 'cube' | 'cone';

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
}

const BLUE_TEAM_SPHERES = 12;
const RED_TEAM_SPHERES = 10;

// Keep in sync with UnitFactory sphere mesh size (world units).
const SPHERE_RADIUS = 2;
const SPHERE_MASS = 2;
const SPHERE_STOP_RANGE = 18;
const SPHERE_MAX_HEALTH = 90;

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

// Bigger spacing to avoid overlaps (radius=2 => diameter=4).
// Different formation params per team to make them feel less mirrored.
const blueSpawns = makeFormation(BLUE_TEAM_SPHERES, {
  cols: 4,
  spacingX: 7,
  spacingZ: 7,
  startZ: 6,
  rowSkewX: 0.35,
  rowStaggerX: 1.1,
  jitter: 0.6,
  seed: 0xB10E,
});

const redSpawns = makeFormation(RED_TEAM_SPHERES, {
  cols: 5,
  spacingX: 6.5,
  spacingZ: 7.5,
  startZ: 5,
  rowSkewX: -0.45,
  rowStaggerX: 0.7,
  jitter: 0.55,
  seed: 0x52ED,
});

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
);
