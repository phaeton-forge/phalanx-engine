/**
 * Fixed-Point Math Module
 *
 * Re-exports from phalanx-math for convenience.
 * The canonical implementation is in phalanx-math.
 *
 * @example
 * ```typescript
 * import { FP, FPVector3 } from '@phalanx-engine/server';
 *
 * const position = FPVector3.FromFloat(10.5, 0, 20.3);
 * const target = FPVector3.FromFloat(5.0, 0, 10.0);
 *
 * const distance = FPVector3.Distance(position, target);
 *
 * // Convert back to number for display
 * console.log(FP.ToFloat(distance));
 * ```
 */

// Re-export everything from phalanx-math
export {
  // Core type
  FixedPoint,
  // Unified API (Unity/Quantum style)
  FP,
  FPVector2,
  FPVector3,
} from '@phalanx-engine/math';

export type { FPVector2 as FPVector2Interface, FPVector3 as FPVector3Interface } from '@phalanx-engine/math';
