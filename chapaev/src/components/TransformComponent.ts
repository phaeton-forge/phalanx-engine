import { SoAComponent, defineSoASchema } from 'phalanx-ecs';
import { ComponentType } from './Component.ts';
import { FP, FPVector3 } from 'phalanx-math';
import type { FPVector3 as FPVector3Type } from 'phalanx-math';

/**
 * Transform SoA Schema
 *
 * Stores authoritative positions as i64 (raw FixedPoint base values) for exact
 * deterministic round-trips. Visual positions remain f64 for rendering.
 */
export const TransformSoASchema = defineSoASchema({
  fpPositionX: 'i64',
  fpPositionY: 'i64',
  fpPositionZ: 'i64',
  visualPositionX: 'f64',
  visualPositionY: 'f64',
  visualPositionZ: 'f64',
}, 'Transform');

/**
 * TransformComponent — stores entity position (authoritative FP + visual floats).
 *
 * Uses SoA (Structure-of-Arrays) storage for cache-friendly iteration.
 */
export class TransformComponent extends SoAComponent<typeof TransformSoASchema.definition> {
  public readonly type = ComponentType.Transform;
  static readonly soaSchema = TransformSoASchema;

  /** Reusable objects to avoid allocations in hot-path getters */
  private readonly _fpPos: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  constructor(entityId: number, initialPosition?: FPVector3Type) {
    const pos = initialPosition ?? FPVector3.Zero;
    const visual = FPVector3.ToFloat(pos);

    super(TransformSoASchema, entityId, {
      fpPositionX: FP.ToRaw(pos.x),
      fpPositionY: FP.ToRaw(pos.y),
      fpPositionZ: FP.ToRaw(pos.z),
      visualPositionX: visual.x,
      visualPositionY: visual.y,
      visualPositionZ: visual.z,
    });
  }

  // ─── Fixed-Point (Authoritative) ──────────────────────────────

  public get fpPosition(): FPVector3Type {
    const idx = this.getIndex();
    if (idx === -1) return this._fpPos;

    this._fpPos.x = FP.FromRaw(this.store.arrays.fpPositionX[idx]);
    this._fpPos.y = FP.FromRaw(this.store.arrays.fpPositionY[idx]);
    this._fpPos.z = FP.FromRaw(this.store.arrays.fpPositionZ[idx]);
    return this._fpPos;
  }

  public set fpPosition(value: FPVector3Type) {
    const idx = this.getIndex();
    if (idx === -1) return;

    this.store.arrays.fpPositionX[idx] = FP.ToRaw(value.x);
    this.store.arrays.fpPositionY[idx] = FP.ToRaw(value.y);
    this.store.arrays.fpPositionZ[idx] = FP.ToRaw(value.z);

    // Sync visual position
    this.store.arrays.visualPositionX[idx] = FP.ToFloat(value.x);
    this.store.arrays.visualPositionY[idx] = FP.ToFloat(value.y);
    this.store.arrays.visualPositionZ[idx] = FP.ToFloat(value.z);
  }

  // ─── Visual Position (Rendering) ──────────────────────────────

  public get visualPositionX(): number {
    const idx = this.getIndex();
    if (idx === -1) return 0;
    return this.store.arrays.visualPositionX[idx];
  }

  public get visualPositionY(): number {
    const idx = this.getIndex();
    if (idx === -1) return 0;
    return this.store.arrays.visualPositionY[idx];
  }

  public get visualPositionZ(): number {
    const idx = this.getIndex();
    if (idx === -1) return 0;
    return this.store.arrays.visualPositionZ[idx];
  }

  public setVisualPosition(x: number, y: number, z: number): void {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.visualPositionX[idx] = x;
    this.store.arrays.visualPositionY[idx] = y;
    this.store.arrays.visualPositionZ[idx] = z;
  }
}

