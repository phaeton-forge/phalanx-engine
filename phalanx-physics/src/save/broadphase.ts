import type {
  GameWorld,
  SaveSection,
  StateReader,
  StateWriter,
} from '@phalanx-engine/ecs';
import { FixedPoint } from '@phalanx-engine/math';
import type { BroadphaseCenter } from '../collision/SpatialHashGrid.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { PhysicsSystem } from '../systems/PhysicsSystem.js';

/** `context.physics` when it exposes the broadphase hooks. */
const PHYSICS_KEY = 'physics';

/**
 * A registered `PhysicsSystem` whose grid is not the one already saved
 * from `context.physics`.
 */
const PHYSICS_SYSTEM_KEY = 'physicsSystem';

/** A registered `CollisionSystem` with its own grid. */
const COLLISION_SYSTEM_KEY = 'collisionSystem';

interface BroadphaseOwner {
  getBroadphaseCenters(): readonly BroadphaseCenter[];
  restoreBroadphase(centers: readonly BroadphaseCenter[]): void;
  rebuildBroadphase(): void;
}

interface NamedBroadphase {
  readonly key: string;
  readonly owner: BroadphaseOwner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBroadphaseOwner(value: unknown): value is BroadphaseOwner {
  if (!isRecord(value)) return false;
  return (
    typeof value['getBroadphaseCenters'] === 'function' &&
    typeof value['restoreBroadphase'] === 'function' &&
    typeof value['rebuildBroadphase'] === 'function'
  );
}

/**
 * Object identity of the underlying grid, so a `PhysicsWorld` and the
 * `PhysicsSystem` it owns are saved once.
 */
function spatialGridOf(owner: BroadphaseOwner): object | null {
  // BroadphaseOwner is the method trio. PhysicsWorld also exposes
  // `spatialGrid`; PhysicsSystem exposes `getSpatialGrid()`. The cast
  // reads those optional fields without widening the public helper type.
  const record = owner as unknown as Record<string, unknown>;
  const getSpatialGrid = record['getSpatialGrid'];
  if (typeof getSpatialGrid === 'function') {
    const grid = (getSpatialGrid as () => unknown).call(owner);
    if (isRecord(grid)) return grid;
  }
  const grid = record['spatialGrid'];
  if (isRecord(grid)) return grid;
  return null;
}

/**
 * Physics facade on `context.physics`, then a registered `PhysicsSystem`
 * or `CollisionSystem` when that system has a different grid.
 */
function collectBroadphases(world: GameWorld): NamedBroadphase[] {
  const found: NamedBroadphase[] = [];
  const seen = new Set<object>();
  const remember = (key: string, owner: BroadphaseOwner): void => {
    const identity = spatialGridOf(owner) ?? owner;
    if (seen.has(identity)) return;
    seen.add(identity);
    found.push({ key, owner });
  };

  const physics = world.context.physics;
  if (isBroadphaseOwner(physics)) {
    remember(PHYSICS_KEY, physics);
  }

  const physicsSystem = world.getSystem(PhysicsSystem);
  if (physicsSystem !== undefined && isBroadphaseOwner(physicsSystem)) {
    remember(PHYSICS_SYSTEM_KEY, physicsSystem);
  }

  const collisionSystem = world.getSystem(CollisionSystem);
  if (collisionSystem !== undefined && isBroadphaseOwner(collisionSystem)) {
    remember(COLLISION_SYSTEM_KEY, collisionSystem);
  }

  return found;
}

function requireBroadphases(
  world: GameWorld,
  helper: string
): NamedBroadphase[] {
  const grids = collectBroadphases(world);
  if (grids.length === 0) {
    throw new Error(`${helper}: world has no broadphase`);
  }
  return grids;
}

function fixedPointParts(value: FixedPoint): {
  base: bigint;
  precision: bigint;
} {
  const base: unknown = value.base;
  const precision: unknown = value.precision;
  if (typeof base !== 'bigint') {
    throw new Error('writeBroadphase: fixed-point base is not a bigint');
  }
  if (typeof precision === 'bigint') {
    return { base, precision };
  }
  if (typeof precision === 'number' && Number.isSafeInteger(precision)) {
    return { base, precision: BigInt(precision) };
  }
  throw new Error('writeBroadphase: fixed-point precision is not an integer');
}

/**
 * Raw base plus the value's own precision. `FP.FromRaw` would default to
 * precision 5 and is not used here.
 */
function writeFixedPoint(w: StateWriter, value: FixedPoint): void {
  const parts = fixedPointParts(value);
  w.i64(parts.base);
  w.i64(parts.precision);
}

function readFixedPoint(r: StateReader): FixedPoint {
  const base = r.i64();
  const precision = r.i64();
  return new FixedPoint(base, precision);
}

function readCenter(r: StateReader): BroadphaseCenter {
  return {
    entityId: r.u32(),
    x: readFixedPoint(r),
    z: readFixedPoint(r),
    radius: readFixedPoint(r),
  };
}

/**
 * Cached broadphase centers for every physics grid on the world.
 *
 * These are the fixed-point positions and radii last passed to
 * `SpatialHashGrid.insert` (`getCenters`), not the saved transforms and
 * not the lossy `lastX` / `lastZ` floats. Each of `x`, `z`, and `radius`
 * stores its raw base and its own precision.
 *
 * After a resolving step the grid still holds the pre-separation centers.
 * Restore them with {@link readBroadphase}.
 */
export function writeBroadphase(w: StateWriter, world: GameWorld): void {
  const grids = requireBroadphases(world, 'writeBroadphase');
  w.list(grids, (grid, item) => {
    item.str(grid.key);
    item.list(grid.owner.getBroadphaseCenters(), (center, centerWriter) => {
      centerWriter.u32(center.entityId);
      writeFixedPoint(centerWriter, center.x);
      writeFixedPoint(centerWriter, center.z);
      writeFixedPoint(centerWriter, center.radius);
    });
  });
}

/** Re-inserts the centers saved by {@link writeBroadphase}. */
export function readBroadphase(r: StateReader, world: GameWorld): void {
  const grids = requireBroadphases(world, 'readBroadphase');
  const saved = r.list((item) => ({
    key: item.str(),
    centers: item.list((centerReader) => readCenter(centerReader)),
  }));
  if (saved.length !== grids.length) {
    throw new Error(
      `readBroadphase: expected ${String(grids.length)} grid(s), found ${String(saved.length)}`
    );
  }
  for (let index = 0; index < grids.length; index += 1) {
    const live = grids[index];
    const item = saved[index];
    if (live === undefined || item === undefined) {
      throw new Error('readBroadphase: missing grid');
    }
    if (item.key !== live.key) {
      throw new Error(
        `readBroadphase: expected grid '${live.key}', found '${item.key}'`
      );
    }
    live.owner.restoreBroadphase(item.centers);
  }
}

const BROADPHASE_SECTION: SaveSection = {
  key: 'physics.broadphase',
  version: 1,
  write(writer, world) {
    writeBroadphase(writer, world);
  },
  read(reader, world) {
    readBroadphase(reader, world);
  },
};

/**
 * One section per world. A second grid owner sees the key already in
 * `saveSections` and returns. `world` is required: a missing world is a
 * caller bug, not a skipped registration.
 */
export function ensureBroadphaseSection(world: GameWorld): void {
  if (
    world.saveSections.some((section) => section.key === BROADPHASE_SECTION.key)
  ) {
    return;
  }
  world.registerSaveSection(BROADPHASE_SECTION);
}

/** True when the world has at least one physics grid to snapshot. */
export function hasBroadphase(world: GameWorld): boolean {
  return collectBroadphases(world).length > 0;
}

/**
 * Rebuild every grid from the current transforms.
 *
 * Valid only for a collision-free world: no resolving step has moved a
 * body since the centers were inserted (a fresh world before its first
 * physics step). After a collision the live grid still holds the
 * pre-separation centers; use {@link readBroadphase} for that.
 */
export function rebuildBroadphaseFromTransforms(world: GameWorld): void {
  const grids = requireBroadphases(world, 'rebuildBroadphaseFromTransforms');
  for (const grid of grids) {
    grid.owner.rebuildBroadphase();
  }
}
