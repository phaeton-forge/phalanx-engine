import { SoAComponent, defineSoASchema } from '@phalanx-engine/ecs';
import { ComponentType } from './Component';
import { FP, type FixedPoint, FPVector3, type FPVector3 as FPVector3Type } from '@phalanx-engine/math';
import { Vector3 } from '@babylonjs/core';

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
 * TransformComponent - Stores entity position and visual position
 *
 * Uses SoA (Structure-of-Arrays) storage for cache-friendly iteration.
 * This component provides a façade API over the underlying typed arrays.
 *
 * For hot-path access, systems can use the SoA store directly:
 * ```typescript
 * const store = entityManager.getSoAStore(TransformSoASchema);
 * const idx = store.indexOf(entityId);
 * const rawX = store.arrays.fpPositionX[idx];
 * ```
 */
export class TransformComponent extends SoAComponent<typeof TransformSoASchema.definition> {
  public readonly type = ComponentType.Transform;
  static readonly soaSchema = TransformSoASchema;

  /** Reusable Vector3 for returning visual position without allocation */
  private readonly _visualPosition: Vector3 = new Vector3();

  /** Reusable FPVector3 for returning fp position without allocation */
  private readonly _fpPosition: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

  constructor(entityId: number, initialPosition?: FPVector3Type) {
    const pos = initialPosition ?? FPVector3.Zero;
    const visualPos = FPVector3.ToFloat(pos);

    const rawX = FP.ToRaw(pos.x);
    const rawY = FP.ToRaw(pos.y);
    const rawZ = FP.ToRaw(pos.z);

    super(TransformSoASchema, entityId, {
      fpPositionX: rawX,
      fpPositionY: rawY,
      fpPositionZ: rawZ,
      visualPositionX: visualPos.x,
      visualPositionY: visualPos.y,
      visualPositionZ: visualPos.z,
    });

    // DEBUG: trace store values after add
    const idx = this.getIndex();
    const storedRawX = this.store.arrays.fpPositionX[idx];
    const roundTrip = FP.FromRaw(storedRawX);
    console.log(`[Transform DEBUG] entity=${entityId} rawX=${rawX} (type=${typeof rawX}) storedRawX=${storedRawX} (type=${typeof storedRawX}) roundTrip=${FP.ToFloat(roundTrip)} visualX=${visualPos.x}`);
  }

  // ============ Fixed-Point Position (Authoritative) ============

  /**
   * Get the fixed-point position (authoritative, deterministic)
   * Returns a reference to a cached object - do not mutate directly
   */
  public get fpPosition(): FPVector3Type {
    const idx = this.getIndex();
    if (idx === -1) {
      console.warn(`[TransformComponent] fpPosition: getIndex returned -1 for entity=${this.entityId}`);
      return this._fpPosition;
    }

    this._fpPosition.x = FP.FromRaw(this.store.arrays.fpPositionX[idx]);
    this._fpPosition.y = FP.FromRaw(this.store.arrays.fpPositionY[idx]);
    this._fpPosition.z = FP.FromRaw(this.store.arrays.fpPositionZ[idx]);
    return this._fpPosition;
  }

  /**
   * Set the fixed-point position (authoritative)
   * Also updates visual position to match
   */
  public set fpPosition(value: FPVector3Type) {
    const idx = this.getIndex();
    if (idx === -1) return;

    this.store.arrays.fpPositionX[idx] = FP.ToRaw(value.x);
    this.store.arrays.fpPositionY[idx] = FP.ToRaw(value.y);
    this.store.arrays.fpPositionZ[idx] = FP.ToRaw(value.z);

    // Also update visual position
    const fx = FP.ToFloat(value.x);
    const fy = FP.ToFloat(value.y);
    const fz = FP.ToFloat(value.z);
    this.store.arrays.visualPositionX[idx] = fx;
    this.store.arrays.visualPositionY[idx] = fy;
    this.store.arrays.visualPositionZ[idx] = fz;
  }

  /**
   * Set x component of fixed-point position
   */
  public setFpX(x: FixedPoint): void {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.fpPositionX[idx] = FP.ToRaw(x);
    this.store.arrays.visualPositionX[idx] = FP.ToFloat(x);
  }

  /**
   * Set z component of fixed-point position
   */
  public setFpZ(z: FixedPoint): void {
    const idx = this.getIndex();
    if (idx === -1) return;
    this.store.arrays.fpPositionZ[idx] = FP.ToRaw(z);
    this.store.arrays.visualPositionZ[idx] = FP.ToFloat(z);
  }

  // ============ Visual Position (For Rendering) ============

  /**
   * Get the visual position (may be interpolated for smooth rendering)
   * Returns a reference to a cached Vector3 - do not mutate
   */
  public get visualPosition(): Vector3 {
    const idx = this.getIndex();
    if (idx === -1) return this._visualPosition;

    this._visualPosition.set(
      this.store.arrays.visualPositionX[idx],
      this.store.arrays.visualPositionY[idx],
      this.store.arrays.visualPositionZ[idx]
    );
    return this._visualPosition;
  }

  /**
   * Set visual position (for interpolation, doesn't affect simulation)
   */
  public setVisualPosition(x: number, y: number, z: number): void {
    const idx = this.getIndex();
    if (idx === -1) return;

    this.store.arrays.visualPositionX[idx] = x;
    this.store.arrays.visualPositionY[idx] = y;
    this.store.arrays.visualPositionZ[idx] = z;
  }

  /**
   * Copy visual position from authoritative fpPosition
   */
  public syncVisualFromFp(): void {
    const idx = this.getIndex();
    if (idx === -1) return;

    this.store.arrays.visualPositionX[idx] = FP.ToFloat(FP.FromRaw(this.store.arrays.fpPositionX[idx]));
    this.store.arrays.visualPositionY[idx] = FP.ToFloat(FP.FromRaw(this.store.arrays.fpPositionY[idx]));
    this.store.arrays.visualPositionZ[idx] = FP.ToFloat(FP.FromRaw(this.store.arrays.fpPositionZ[idx]));
  }

  // ============ Convenience Methods ============

  /**
   * Get position as Vector3 (simulation position, not interpolated)
   * Creates a new Vector3 - use sparingly in hot paths
   */
  public get position(): Vector3 {
    const idx = this.getIndex();
    if (idx === -1) return Vector3.Zero();

    return new Vector3(
      FP.ToFloat(FP.FromRaw(this.store.arrays.fpPositionX[idx])),
      FP.ToFloat(FP.FromRaw(this.store.arrays.fpPositionY[idx])),
      FP.ToFloat(FP.FromRaw(this.store.arrays.fpPositionZ[idx]))
    );
  }

  /**
   * Set position from a Vector3 (converts to fixed-point)
   */
  public set position(value: Vector3) {
    this.fpPosition = FPVector3.FromFloat(value.x, value.y, value.z);
  }
}
