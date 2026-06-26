/**
 * Phalanx Math - Deterministic Fixed-Point Math Library
 *
 * Provides cross-platform deterministic arithmetic for lockstep multiplayer games.
 * All operations produce identical results regardless of hardware or platform.
 *
 * @packageDocumentation
 */

export {
  // Core types
  FixedPoint,
  // Unified API (Unity/Quantum style)
  FP,
  FPVector2,
  FPVector3,
  FPQuaternion,
} from './FixedMath.js';

export type {
  // 2D vector interface (type-only export to avoid conflict with const)
  FPVector2 as FPVector2Interface,
  // 3D vector interface (type-only export to avoid conflict with const)
  FPVector3 as FPVector3Interface,
  // Quaternion interface (type-only export to avoid conflict with const)
  FPQuaternion as FPQuaternionInterface,
} from './FixedMath.js';
