import { FP, type FixedPoint } from '@phalanx-engine/math';

/**
 * Deterministic spatial hash grid for broad-phase collision detection.
 *
 * Uses fixed-point math for cell computation and maintains entity
 * positions for efficient insert/remove/update. Outputs deduplicated,
 * sorted collision pair candidates.
 *
 * Zero-GC design: reuses internal arrays between calls.
 */
/**
 * Fixed-point center cached when a body was inserted into the broadphase.
 *
 * After collision resolution the transform may have moved; this center is
 * the pre-separation position the grid still queries against. `radius` is
 * the radius passed to {@link SpatialHashGrid.insert}: cell coverage
 * depends on it, and a restore that drops it rebuilds the wrong cells.
 * `x`, `z`, and `radius` are copies, so mutating them does not change the
 * grid.
 */
export interface BroadphaseCenter {
  readonly entityId: number;
  readonly x: FixedPoint;
  readonly z: FixedPoint;
  readonly radius: FixedPoint;
}

export class SpatialHashGrid {
  private readonly cellSize: FixedPoint;
  private readonly cells: Map<string, number[]> = new Map();

  /** Tracks which cells each entity occupies for efficient removal */
  private readonly entityCells: Map<number, string[]> = new Map();

  /**
   * Center positions per entity, kept in sync with insert/remove/clear.
   * Used by {@link queryRadius} for exact (narrow-phase) distance filtering.
   */
  private readonly entityPosX: Map<number, FixedPoint> = new Map();
  private readonly entityPosZ: Map<number, FixedPoint> = new Map();
  /** Radius used for cell coverage at insert/update. Not used by queryRadius. */
  private readonly entityRadius: Map<number, FixedPoint> = new Map();

  /** Reusable pairs array — cleared and reused each queryPairs() call */
  private readonly _pairsResult: [number, number][] = [];

  /** Reusable radius query result */
  private readonly _radiusResult: number[] = [];

  constructor(cellSize: FixedPoint) {
    this.cellSize = cellSize;
  }

  /**
   * Insert an entity into all cells it overlaps.
   */
  public insert(entityId: number, posX: FixedPoint, posZ: FixedPoint, radius: FixedPoint): void {
    const cellKeys = this.getCoveredCells(posX, posZ, radius);
    this.entityCells.set(entityId, cellKeys);
    // Store the center position for exact distance filtering in queryRadius.
    this.entityPosX.set(entityId, posX);
    this.entityPosZ.set(entityId, posZ);
    this.entityRadius.set(entityId, radius);

    for (const key of cellKeys) {
      let cell = this.cells.get(key);
      if (!cell) {
        cell = [];
        this.cells.set(key, cell);
      }
      cell.push(entityId);
    }
  }

  /**
   * Remove an entity from all cells it occupies.
   */
  public remove(entityId: number): void {
    const cellKeys = this.entityCells.get(entityId);
    if (!cellKeys) return;

    for (const key of cellKeys) {
      const cell = this.cells.get(key);
      if (cell) {
        const idx = cell.indexOf(entityId);
        if (idx !== -1) {
          // Swap-and-pop for O(1) removal
          cell[idx] = cell[cell.length - 1];
          cell.pop();
        }
        if (cell.length === 0) {
          this.cells.delete(key);
        }
      }
    }
    this.entityCells.delete(entityId);
    this.entityPosX.delete(entityId);
    this.entityPosZ.delete(entityId);
    this.entityRadius.delete(entityId);
  }

  /**
   * Update an entity's position in the grid (remove + re-insert).
   */
  public update(entityId: number, posX: FixedPoint, posZ: FixedPoint, radius: FixedPoint): void {
    this.remove(entityId);
    this.insert(entityId, posX, posZ, radius);
  }

  /**
   * Return all candidate collision pairs from the grid.
   * Pairs are deduplicated and ordered (A < B) for determinism.
   *
   * NOTE: This implementation does NOT scan the 9-cell neighborhood explicitly.
   * Instead, entities are inserted into ALL cells their bounding circle overlaps
   * (see insert()). Two circles that overlap will always share at least one cell,
   * so intra-cell pair checking is sufficient. The 9-cell scan is redundant here.
   */
  public queryPairs(): [number, number][] {
    this._pairsResult.length = 0;
    const seen = new Set<string>();

    for (const cell of this.cells.values()) {
      const len = cell.length;
      for (let i = 0; i < len; i++) {
        for (let j = i + 1; j < len; j++) {
          const a = cell[i];
          const b = cell[j];
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;
          const key = `${lo},${hi}`;
          if (!seen.has(key)) {
            seen.add(key);
            this._pairsResult.push([lo, hi]);
          }
        }
      }
    }

    // Sort for deterministic order: by first ID, then second
    this._pairsResult.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return this._pairsResult;
  }

  /**
   * Query all entities whose center lies within `radius` of the point
   * `(posX, posZ)`. Results are sorted by entity ID for determinism.
   *
   * Two-phase, but the exact pass is internal so callers never re-check distance:
   *   - broad-phase: gather candidates from overlapping grid cells.
   *   - narrow-phase: keep only candidates whose squared center-distance is
   *     `<= radius²` (uses the center positions recorded on insert/update).
   *
   * Distance is measured center-to-center (the queried bodies' radii are not
   * added); this matches "units within range of a point" semantics used by
   * auras, AoE, and range finding.
   */
  public queryRadius(posX: FixedPoint, posZ: FixedPoint, radius: FixedPoint): number[] {
    this._radiusResult.length = 0;
    const seen = new Set<number>();
    const radiusSq = FP.Mul(radius, radius);

    const cellKeys = this.getCoveredCells(posX, posZ, radius);
    for (const key of cellKeys) {
      const cell = this.cells.get(key);
      if (!cell) continue;
      for (const id of cell) {
        if (seen.has(id)) continue;
        seen.add(id);

        const px = this.entityPosX.get(id);
        const pz = this.entityPosZ.get(id);
        if (px === undefined || pz === undefined) continue;

        const dx = FP.Sub(px, posX);
        const dz = FP.Sub(pz, posZ);
        const distanceSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
        if (FP.Lte(distanceSq, radiusSq)) {
          this._radiusResult.push(id);
        }
      }
    }

    this._radiusResult.sort((a, b) => a - b);
    return this._radiusResult;
  }

  /**
   * Cached centers in ascending entity id.
   *
   * These are the positions stored at {@link insert} / {@link update}, not
   * a live read of the transform. Empty when the grid has been {@link clear}ed.
   */
  public getCenters(): readonly BroadphaseCenter[] {
    const ids: number[] = [];
    for (const id of this.entityPosX.keys()) {
      ids.push(id);
    }
    ids.sort((a, b) => a - b);

    const centers: BroadphaseCenter[] = [];
    for (const entityId of ids) {
      const x = this.entityPosX.get(entityId);
      const z = this.entityPosZ.get(entityId);
      const radius = this.entityRadius.get(entityId);
      if (x === undefined || z === undefined || radius === undefined) {
        continue;
      }
      centers.push({
        entityId,
        x: FP.FromRaw(FP.ToRaw(x)),
        z: FP.FromRaw(FP.ToRaw(z)),
        radius: FP.FromRaw(FP.ToRaw(radius)),
      });
    }
    return centers;
  }

  /**
   * Replace the grid with a saved center snapshot.
   *
   * Clears every cell, then inserts in ascending entity id. Cell coverage
   * uses each center's saved radius. Pass the centers from {@link getCenters}
   * on the live grid: {@link SpatialHashGrid} does not read transforms.
   *
   * @throws If `centers` contains a duplicate entity id.
   */
  public restoreBroadphase(centers: readonly BroadphaseCenter[]): void {
    const ordered = centers.slice();
    ordered.sort((a, b) => a.entityId - b.entityId);

    let previousId: number | undefined;
    for (const center of ordered) {
      if (previousId === center.entityId) {
        throw new Error(
          `SpatialHashGrid.restoreBroadphase: duplicate entity id ${center.entityId}`
        );
      }
      previousId = center.entityId;
    }

    this.clear();
    for (const center of ordered) {
      this.insert(center.entityId, center.x, center.z, center.radius);
    }
  }

  /**
   * Remove all entities from the grid.
   */
  public clear(): void {
    this.cells.clear();
    this.entityCells.clear();
    this.entityPosX.clear();
    this.entityPosZ.clear();
    this.entityRadius.clear();
  }

  /**
   * Compute all cell keys that a circle at (posX, posZ) with radius overlaps.
   */
  private getCoveredCells(posX: FixedPoint, posZ: FixedPoint, radius: FixedPoint): string[] {
    const minX = FP.Sub(posX, radius);
    const maxX = FP.Add(posX, radius);
    const minZ = FP.Sub(posZ, radius);
    const maxZ = FP.Add(posZ, radius);

    const cellMinX = FP.ToFloat(FP.Floor(FP.Div(minX, this.cellSize)));
    const cellMaxX = FP.ToFloat(FP.Floor(FP.Div(maxX, this.cellSize)));
    const cellMinZ = FP.ToFloat(FP.Floor(FP.Div(minZ, this.cellSize)));
    const cellMaxZ = FP.ToFloat(FP.Floor(FP.Div(maxZ, this.cellSize)));

    const keys: string[] = [];
    for (let cx = cellMinX; cx <= cellMaxX; cx++) {
      for (let cz = cellMinZ; cz <= cellMaxZ; cz++) {
        keys.push(`${cx},${cz}`);
      }
    }
    return keys;
  }
}
