/**
 * Math Conversion Utilities
 *
 * Provides conversion functions between fixed-point math types (phalanx-math)
 * and Babylon.js Vector types for rendering interpolation.
 *
 * ARCHITECTURE:
 * - Simulation uses fixed-point math (FPVector2, FPVector3) for determinism
 * - Rendering uses Babylon.js vectors (Vector3) for GPU compatibility
 * - These utilities bridge the gap for smooth visual interpolation
 *
 * @example
 * ```typescript
 * import { fpToVector3, vector3ToFp, lerpVector3FromFp } from './core/MathConversions';
 *
 * // Convert fixed-point position to Babylon Vector3 for rendering
 * const renderPos = fpToVector3(entity.fpPosition);
 *
 * // Interpolate between two fixed-point positions for smooth visuals
 * const visualPos = lerpVector3FromFp(prevFpPos, currFpPos, alpha);
 * ```
 */

import { Vector3, Vector2 } from '@babylonjs/core';
import {
  FP,
  FPVector2,
  FPVector3,
  type FPVector2 as FPVector2Type,
  type FPVector3 as FPVector3Type,
} from 'phalanx-math';

// ============ FPVector3 ↔ Vector3 Conversions ============

/**
 * Convert FPVector3 (fixed-point) to Babylon Vector3 (float)
 * Use this when you need to render or display a fixed-point position
 *
 * @param fp - Fixed-point 3D vector
 * @returns New Babylon Vector3 with float values
 */
export function fpToVector3(fp: FPVector3Type): Vector3 {
  const floats = FPVector3.ToFloat(fp);
  return new Vector3(floats.x, floats.y, floats.z);
}

/**
 * Convert FPVector3 to Babylon Vector3, writing to an existing Vector3
 * Use this to avoid allocations in hot paths (like render loops)
 *
 * @param fp - Fixed-point 3D vector
 * @param out - Existing Vector3 to write to
 * @returns The same Vector3 passed in (for chaining)
 */
export function fpToVector3Ref(fp: FPVector3Type, out: Vector3): Vector3 {
  const floats = FPVector3.ToFloat(fp);
  out.set(floats.x, floats.y, floats.z);
  return out;
}

/**
 * Convert Babylon Vector3 (float) to FPVector3 (fixed-point)
 * Use this when converting user input or editor positions to simulation
 *
 * WARNING: This conversion may lose precision. Only use for initialization
 * or user input, never in the middle of deterministic calculations.
 *
 * @param v - Babylon Vector3
 * @returns New FPVector3 with fixed-point values
 */
export function vector3ToFp(v: Vector3): FPVector3Type {
  return FPVector3.FromFloat(v.x, v.y, v.z);
}

/**
 * Interpolate between two FPVector3 positions and return as Vector3
 * Use this in render loops for smooth visual interpolation between simulation ticks
 *
 * @param from - Previous tick's fixed-point position
 * @param to - Current tick's fixed-point position
 * @param alpha - Interpolation factor (0 = from, 1 = to)
 * @returns New Babylon Vector3 with interpolated float values
 */
export function lerpVector3FromFp(
  from: FPVector3Type,
  to: FPVector3Type,
  alpha: number
): Vector3 {
  // Convert to floats first, then lerp (more efficient than FP lerp for visuals)
  const fromFloats = FPVector3.ToFloat(from);
  const toFloats = FPVector3.ToFloat(to);

  return new Vector3(
    fromFloats.x + (toFloats.x - fromFloats.x) * alpha,
    fromFloats.y + (toFloats.y - fromFloats.y) * alpha,
    fromFloats.z + (toFloats.z - fromFloats.z) * alpha
  );
}

/**
 * Interpolate between two FPVector3 positions, writing to an existing Vector3
 * Use this to avoid allocations in hot paths (like render loops)
 *
 * @param from - Previous tick's fixed-point position
 * @param to - Current tick's fixed-point position
 * @param alpha - Interpolation factor (0 = from, 1 = to)
 * @param out - Existing Vector3 to write to
 * @returns The same Vector3 passed in (for chaining)
 */
export function lerpVector3FromFpRef(
  from: FPVector3Type,
  to: FPVector3Type,
  alpha: number,
  out: Vector3
): Vector3 {
  const fromFloats = FPVector3.ToFloat(from);
  const toFloats = FPVector3.ToFloat(to);

  out.set(
    fromFloats.x + (toFloats.x - fromFloats.x) * alpha,
    fromFloats.y + (toFloats.y - fromFloats.y) * alpha,
    fromFloats.z + (toFloats.z - fromFloats.z) * alpha
  );
  return out;
}

// ============ FPVector2 ↔ Vector2/Vector3 Conversions ============

/**
 * Convert FPVector2 (fixed-point) to Babylon Vector2 (float)
 *
 * @param fp - Fixed-point 2D vector
 * @returns New Babylon Vector2 with float values
 */
export function fpToVector2(fp: FPVector2Type): Vector2 {
  const floats = FPVector2.ToFloat(fp);
  return new Vector2(floats.x, floats.y);
}

/**
 * Convert FPVector2 to Babylon Vector2, writing to an existing Vector2
 * Use this to avoid allocations in hot paths
 *
 * @param fp - Fixed-point 2D vector
 * @param out - Existing Vector2 to write to
 * @returns The same Vector2 passed in (for chaining)
 */
export function fpToVector2Ref(fp: FPVector2Type, out: Vector2): Vector2 {
  const floats = FPVector2.ToFloat(fp);
  out.set(floats.x, floats.y);
  return out;
}

/**
 * Convert FPVector2 to Babylon Vector3 (with y=0 for XZ plane)
 * Useful for 2D game logic mapped to 3D rendering where Y is up
 *
 * @param fp - Fixed-point 2D vector (treated as XZ coordinates)
 * @param y - Y coordinate to use (default: 0)
 * @returns New Babylon Vector3 with (fp.x, y, fp.y)
 */
export function fpVector2ToVector3XZ(fp: FPVector2Type, y: number = 0): Vector3 {
  const floats = FPVector2.ToFloat(fp);
  return new Vector3(floats.x, y, floats.y);
}

/**
 * Convert FPVector2 to Babylon Vector3 (with z=0 for XY plane)
 * Useful for 2D game logic where Z is depth
 *
 * @param fp - Fixed-point 2D vector (treated as XY coordinates)
 * @param z - Z coordinate to use (default: 0)
 * @returns New Babylon Vector3 with (fp.x, fp.y, z)
 */
export function fpVector2ToVector3XY(fp: FPVector2Type, z: number = 0): Vector3 {
  const floats = FPVector2.ToFloat(fp);
  return new Vector3(floats.x, floats.y, z);
}

/**
 * Convert Babylon Vector2 (float) to FPVector2 (fixed-point)
 *
 * WARNING: This conversion may lose precision. Only use for initialization
 * or user input, never in the middle of deterministic calculations.
 *
 * @param v - Babylon Vector2
 * @returns New FPVector2 with fixed-point values
 */
export function vector2ToFp(v: Vector2): FPVector2Type {
  return FPVector2.FromFloat(v.x, v.y);
}

/**
 * Convert Babylon Vector3 XZ components to FPVector2 (fixed-point)
 * Useful for extracting 2D position from 3D world where Y is up
 *
 * @param v - Babylon Vector3
 * @returns New FPVector2 with (v.x, v.z) as fixed-point
 */
export function vector3XZToFpVector2(v: Vector3): FPVector2Type {
  return FPVector2.FromFloat(v.x, v.z);
}

/**
 * Interpolate between two FPVector2 positions and return as Vector2
 *
 * @param from - Previous tick's fixed-point position
 * @param to - Current tick's fixed-point position
 * @param alpha - Interpolation factor (0 = from, 1 = to)
 * @returns New Babylon Vector2 with interpolated float values
 */
export function lerpVector2FromFp(
  from: FPVector2Type,
  to: FPVector2Type,
  alpha: number
): Vector2 {
  const fromFloats = FPVector2.ToFloat(from);
  const toFloats = FPVector2.ToFloat(to);

  return new Vector2(
    fromFloats.x + (toFloats.x - fromFloats.x) * alpha,
    fromFloats.y + (toFloats.y - fromFloats.y) * alpha
  );
}

/**
 * Interpolate between two FPVector2 positions, writing to an existing Vector2
 *
 * @param from - Previous tick's fixed-point position
 * @param to - Current tick's fixed-point position
 * @param alpha - Interpolation factor (0 = from, 1 = to)
 * @param out - Existing Vector2 to write to
 * @returns The same Vector2 passed in (for chaining)
 */
export function lerpVector2FromFpRef(
  from: FPVector2Type,
  to: FPVector2Type,
  alpha: number,
  out: Vector2
): Vector2 {
  const fromFloats = FPVector2.ToFloat(from);
  const toFloats = FPVector2.ToFloat(to);

  out.set(
    fromFloats.x + (toFloats.x - fromFloats.x) * alpha,
    fromFloats.y + (toFloats.y - fromFloats.y) * alpha
  );
  return out;
}

// ============ Fixed-Point Scalar Conversions ============

/**
 * Convert a FixedPoint scalar to a JavaScript number
 * Convenience wrapper around FP.ToFloat
 *
 * @param fp - Fixed-point number
 * @returns JavaScript number
 */
export function fpToNumber(fp: ReturnType<typeof FP.FromFloat>): number {
  return FP.ToFloat(fp);
}

/**
 * Convert a JavaScript number to FixedPoint
 * Convenience wrapper around FP.FromFloat
 *
 * WARNING: This conversion may lose precision for very small decimals.
 *
 * @param n - JavaScript number
 * @returns Fixed-point number
 */
export function numberToFp(n: number): ReturnType<typeof FP.FromFloat> {
  return FP.FromFloat(n);
}

