/**
 * Fixed-Point Math Module
 *
 * Provides deterministic fixed-point arithmetic for game calculations.
 * All clients using the same operations will produce identical results.
 *
 * This module wraps @hastom/fixed-point library to provide a Unity/Quantum-style API.
 *
 * @example
 * ```typescript
 * import { FP, FPVector3 } from '@phalanx-engine/math';
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

import { FixedPoint, fpFromDecimal, fpFromInt } from '@hastom/fixed-point';

// Re-export FixedPoint class as the number type
export { FixedPoint };

/** Default precision for fixed-point operations (5 decimal places) */
const DEFAULT_PRECISION = 5;

/**
 * FP - Fixed-point number creation, conversion, and math utilities
 * Quantum-style unified API for all fixed-point operations
 */
export const FP = {
  // ============ Creation ============

  /**
   * Create a fixed-point number from a JavaScript number
   *
   * WARNING: This uses toFixed(15) to ensure deterministic conversion across
   * different JavaScript engines (V8/Chrome, JSC/Safari, SpiderMonkey/Firefox).
   * Native toString() can produce different results for the same float.
   *
   * @param value - Number to convert
   * @param precision - Decimal precision (default: 18)
   */
  FromFloat: (value: number, precision: number = DEFAULT_PRECISION): FixedPoint => {
    // Use toFixed(precision) for deterministic conversion across all JS engines
    // This ensures the same string representation regardless of browser
    // and stays within the precision limit of the fixed-point library
    return fpFromDecimal(value.toFixed(precision), precision);
  },

  /**
   * Create a fixed-point number from a string representation
   * @param value - String representation (e.g., "10.5")
   * @param precision - Decimal precision (default: 18)
   */
  FromString: (
    value: string,
    precision: number = DEFAULT_PRECISION
  ): FixedPoint => {
    return fpFromDecimal(value, precision);
  },

  /**
   * Create a fixed-point number from an integer
   * @param value - Integer value
   * @param precision - Decimal precision (default: 18)
   */
  FromInt: (
    value: number | bigint,
    precision: number = DEFAULT_PRECISION
  ): FixedPoint => {
    return fpFromInt(BigInt(value), 0, precision);
  },

  /**
   * Convert a fixed-point number back to a JavaScript number
   */
  ToFloat: (fp: FixedPoint): number => {
    return fp.toDecimal();
  },

  /**
   * Get the raw bigint base value from a FixedPoint
   * Used for SoA storage in BigInt64Array
   *
   * Note: This requires storing the precision separately or assuming
   * all values use DEFAULT_PRECISION (18).
   */
  ToRaw: (fp: FixedPoint): bigint => {
    return fp.base;
  },

  /**
   * Create a FixedPoint from a raw bigint base value
   * Used for reading from SoA storage (BigInt64Array)
   *
   * @param raw - The raw bigint base value
   * @param precision - The precision (default: 18)
   */
  FromRaw: (raw: bigint, precision: number = DEFAULT_PRECISION): FixedPoint => {
    return new FixedPoint(raw, BigInt(precision));
  },

  // ============ Constants (Quantum naming convention) ============

  /** Zero constant */
  _0: fpFromInt(0n, 0, DEFAULT_PRECISION),

  /** One constant */
  _1: fpFromInt(1n, 0, DEFAULT_PRECISION),

  /** Pi constant */
  Pi: fpFromDecimal('3.14159', DEFAULT_PRECISION),

  /** 2*Pi constant (Quantum naming) */
  Pi2: fpFromDecimal('6.28318', DEFAULT_PRECISION),

  /** Pi/2 constant (Quantum naming) */
  PiOver2: fpFromDecimal('1.57079', DEFAULT_PRECISION),

  // ============ Arithmetic Operations ============

  /** Add two fixed-point numbers */
  Add: (a: FixedPoint, b: FixedPoint): FixedPoint => a.add(b),

  /** Subtract two fixed-point numbers */
  Sub: (a: FixedPoint, b: FixedPoint): FixedPoint => a.sub(b),

  /** Multiply two fixed-point numbers */
  Mul: (a: FixedPoint, b: FixedPoint): FixedPoint => a.mul(b),

  /** Divide two fixed-point numbers */
  Div: (a: FixedPoint, b: FixedPoint): FixedPoint => a.div(b),

  /** Negate a fixed-point number */
  Neg: (a: FixedPoint): FixedPoint => a.neg(),

  // ============ Math Functions ============

  /** Square root of a fixed-point number */
  Sqrt: (a: FixedPoint): FixedPoint => a.sqrt(),

  /** Absolute value of a fixed-point number */
  Abs: (a: FixedPoint): FixedPoint => a.abs(),

  /** Floor of a fixed-point number */
  Floor: (a: FixedPoint): FixedPoint => a.floor(),

  /** Ceiling of a fixed-point number */
  Ceil: (a: FixedPoint): FixedPoint => a.ceil(),

  /** Round a fixed-point number */
  Round: (a: FixedPoint): FixedPoint => a.round(),

  /** Minimum of two fixed-point numbers */
  Min: (a: FixedPoint, b: FixedPoint): FixedPoint => FixedPoint.min(a, b),

  /** Maximum of two fixed-point numbers */
  Max: (a: FixedPoint, b: FixedPoint): FixedPoint => FixedPoint.max(a, b),

  // ============ Comparison ============

  /** Check if two fixed-point numbers are equal */
  Eq: (a: FixedPoint, b: FixedPoint): boolean => a.eq(b),

  /** Check if first is less than second */
  Lt: (a: FixedPoint, b: FixedPoint): boolean => a.lt(b),

  /** Check if first is less than or equal to second */
  Lte: (a: FixedPoint, b: FixedPoint): boolean => a.lte(b),

  /** Check if first is greater than second */
  Gt: (a: FixedPoint, b: FixedPoint): boolean => a.gt(b),

  /** Check if first is greater than or equal to second */
  Gte: (a: FixedPoint, b: FixedPoint): boolean => a.gte(b),

  // ============ Interpolation & Clamping ============

  /**
   * Linear interpolation between two values
   * @param a - Start value
   * @param b - End value
   * @param t - Interpolation factor (0-1)
   */
  Lerp: (a: FixedPoint, b: FixedPoint, t: FixedPoint): FixedPoint => {
    return a.add(b.sub(a).mul(t));
  },

  /** Clamp a value between min and max */
  Clamp: (
    value: FixedPoint,
    min: FixedPoint,
    max: FixedPoint
  ): FixedPoint => {
    return FixedPoint.min(FixedPoint.max(value, min), max);
  },

  // ============ Trigonometry ============

  /**
   * Sine approximation using Taylor series (deterministic)
   * Note: Input should be in radians
   */
  Sin: (x: FixedPoint): FixedPoint => {
    const normalized = normalizeAngleRad(x);

    if (FP.Eq(normalized, FP._0)) return FP._0;
    if (FP.Eq(normalized, FP.PiOver2)) return FP._1;
    if (FP.Eq(normalized, FP.Neg(FP.PiOver2))) return FP.Neg(FP._1);
    if (FP.Eq(normalized, FP.Pi) || FP.Eq(normalized, FP.Neg(FP.Pi))) {
      return FP._0;
    }

    // Reduce to [0, PI/2] so the Taylor series converges well (avoids large
    // angles near ±PI where the truncated series loses several percent).
    if (FP.Gt(normalized, FP.PiOver2)) {
      return sinTaylorHalfPi(FP.Sub(FP.Pi, normalized));
    }
    if (FP.Lt(normalized, FP.Neg(FP.PiOver2))) {
      return FP.Neg(sinTaylorHalfPi(FP.Add(FP.Pi, normalized)));
    }
    if (FP.Lt(normalized, FP._0)) {
      return FP.Neg(sinTaylorHalfPi(FP.Neg(normalized)));
    }
    return sinTaylorHalfPi(normalized);
  },

  /**
   * Cosine approximation using Taylor series (deterministic)
   * Note: Input should be in radians
   */
  Cos: (x: FixedPoint): FixedPoint => {
    const normalized = normalizeAngleRad(x);

    if (FP.Eq(normalized, FP._0)) return FP._1;
    if (FP.Eq(normalized, FP.PiOver2) || FP.Eq(normalized, FP.Neg(FP.PiOver2))) {
      return FP._0;
    }
    if (FP.Eq(normalized, FP.Pi) || FP.Eq(normalized, FP.Neg(FP.Pi))) {
      return FP.Neg(FP._1);
    }

    // cos(x) = sin(x + PI/2)
    return FP.Sin(normalized.add(FP.PiOver2));
  },

  /**
   * Approximate atan2 (deterministic)
   * Returns angle in radians
   */
  Atan2: (y: FixedPoint, x: FixedPoint): FixedPoint => {
    // Simple approximation using polynomial
    const pi = FP.Pi;
    const halfPi = FP.PiOver2;
    const zero = FP._0;

    if (x.isZero() && y.isZero()) {
      return zero;
    }

    if (x.isZero()) {
      return y.isPositive() ? halfPi : halfPi.neg();
    }

    const absY = y.abs();
    const absX = x.abs();

    let angle: FixedPoint;
    if (absX.gte(absY)) {
      const ratio = absY.div(absX);
      // Approximate atan using polynomial: atan(t) ≈ t - t³/3 + t⁵/5
      const t2 = ratio.mul(ratio);
      const t3 = t2.mul(ratio);
      const t5 = t3.mul(t2);
      angle = ratio.sub(t3.div(FP.FromInt(3))).add(t5.div(FP.FromInt(5)));
    } else {
      const ratio = absX.div(absY);
      const t2 = ratio.mul(ratio);
      const t3 = t2.mul(ratio);
      const t5 = t3.mul(t2);
      angle = halfPi.sub(
        ratio.sub(t3.div(FP.FromInt(3))).add(t5.div(FP.FromInt(5)))
      );
    }

    // Adjust for quadrant
    if (x.isNegative()) {
      angle = pi.sub(angle);
    }
    if (y.isNegative()) {
      angle = angle.neg();
    }

    return angle;
  },

  /**
   * Arccosine via the atan2 identity: acos(x) = atan2(sqrt(1 - x*x), x).
   * Input is clamped to [-1, 1] to avoid NaN from rounding error.
   * Returns angle in radians within [0, PI].
   */
  Acos: (x: FixedPoint): FixedPoint => {
    const clamped = FP.Clamp(x, FP.FromFloat(-1), FP._1);
    const sinVal = FP.Sqrt(FP.Sub(FP._1, FP.Mul(clamped, clamped)));
    return FP.Atan2(sinVal, clamped);
  },
};

/** Evaluate sin(x) via Taylor series; `x` must already lie in [0, PI/2]. */
function sinTaylorHalfPi(x: FixedPoint): FixedPoint {
  // sin(x) ≈ x - x³/3! + x⁵/5! - x⁷/7!
  const x2 = x.mul(x);
  const x3 = x2.mul(x);
  const x5 = x3.mul(x2);
  const x7 = x5.mul(x2);

  const fact3 = FP.FromInt(6);
  const fact5 = FP.FromInt(120);
  const fact7 = FP.FromInt(5040);

  return x.sub(x3.div(fact3)).add(x5.div(fact5)).sub(x7.div(fact7));
}

/** Normalize radians to [-PI, PI] for deterministic trig. */
function normalizeAngleRad(x: FixedPoint): FixedPoint {
  const twoPi = FP.Pi2;
  const pi = FP.Pi;
  let normalized = x;
  while (normalized.gt(pi)) {
    normalized = normalized.sub(twoPi);
  }
  while (normalized.lt(pi.neg())) {
    normalized = normalized.add(twoPi);
  }
  return normalized;
}

/** Snap yaw values that are within epsilon of a cardinal angle. */
function snapYawToCardinal(yaw: FixedPoint): FixedPoint {
  const eps = FP.FromFloat(0.002);
  const cardinals = [
    FP._0,
    FP.PiOver2,
    FP.Neg(FP.PiOver2),
    FP.Pi,
    FP.Neg(FP.Pi),
  ];
  for (const cardinal of cardinals) {
    if (FP.Lte(yaw.sub(cardinal).abs(), eps)) {
      return cardinal;
    }
  }
  return yaw;
}

/**
 * Fixed-point 2D vector interface
 */
export interface FPVector2 {
  x: FixedPoint;
  y: FixedPoint;
}

/**
 * FPVector2 - Fixed-point 2D vector utilities (Unity/Quantum style)
 */
export const FPVector2 = {
  // ============ Creation ============

  /** Create a new vector from FixedPoint values */
  Create: (x: FixedPoint, y: FixedPoint): FPVector2 => ({ x, y }),

  /** Create a vector from float numbers */
  FromFloat: (x: number, y: number): FPVector2 => ({
    x: FP.FromFloat(x),
    y: FP.FromFloat(y),
  }),

  // ============ Constants ============

  /** Zero vector */
  Zero: { x: FP._0, y: FP._0 } as FPVector2,

  /** One vector (1, 1) */
  One: { x: FP._1, y: FP._1 } as FPVector2,

  /** Up direction (0, 1) - Unity convention */
  Up: { x: FP._0, y: FP._1 } as FPVector2,

  /** Right direction (1, 0) - Unity convention */
  Right: { x: FP._1, y: FP._0 } as FPVector2,

  // ============ Operations ============

  /** Add two vectors */
  Add: (a: FPVector2, b: FPVector2): FPVector2 => ({
    x: a.x.add(b.x),
    y: a.y.add(b.y),
  }),

  /** Subtract two vectors */
  Sub: (a: FPVector2, b: FPVector2): FPVector2 => ({
    x: a.x.sub(b.x),
    y: a.y.sub(b.y),
  }),

  /** Scale a vector by a scalar */
  Scale: (v: FPVector2, s: FixedPoint): FPVector2 => ({
    x: v.x.mul(s),
    y: v.y.mul(s),
  }),

  /** Get the magnitude (length) of a vector - Unity naming */
  Magnitude: (v: FPVector2): FixedPoint => {
    return v.x.mul(v.x).add(v.y.mul(v.y)).sqrt();
  },

  /** Get the squared magnitude of a vector (faster than Magnitude) - Unity naming */
  SqrMagnitude: (v: FPVector2): FixedPoint => {
    return v.x.mul(v.x).add(v.y.mul(v.y));
  },

  /** Normalize a vector (returns new vector) */
  Normalize: (v: FPVector2): FPVector2 => {
    const len = FPVector2.Magnitude(v);
    if (len.isZero()) {
      return { x: FP._0, y: FP._0 };
    }
    return {
      x: v.x.div(len),
      y: v.y.div(len),
    };
  },

  /** Dot product of two vectors */
  Dot: (a: FPVector2, b: FPVector2): FixedPoint => {
    return a.x.mul(b.x).add(a.y.mul(b.y));
  },

  /** Distance between two vectors */
  Distance: (a: FPVector2, b: FPVector2): FixedPoint => {
    const dx = b.x.sub(a.x);
    const dy = b.y.sub(a.y);
    return dx.mul(dx).add(dy.mul(dy)).sqrt();
  },

  /** Squared distance between two vectors (faster than Distance) */
  SqrDistance: (a: FPVector2, b: FPVector2): FixedPoint => {
    const dx = b.x.sub(a.x);
    const dy = b.y.sub(a.y);
    return dx.mul(dx).add(dy.mul(dy));
  },

  /** Linear interpolation between two vectors */
  Lerp: (a: FPVector2, b: FPVector2, t: FixedPoint): FPVector2 => ({
    x: FP.Lerp(a.x, b.x, t),
    y: FP.Lerp(a.y, b.y, t),
  }),

  // ============ Conversion ============

  /** Convert to plain object with float values (for display/serialization) */
  ToFloat: (v: FPVector2): { x: number; y: number } => ({
    x: v.x.toDecimal(),
    y: v.y.toDecimal(),
  }),
};

/**
 * Fixed-point 3D vector interface
 * Renamed from FPPosition for clarity (Quantum uses FPVector3)
 */
export interface FPVector3 {
  x: FixedPoint;
  y: FixedPoint;
  z: FixedPoint;
}

/**
 * FPVector3 - Fixed-point 3D vector utilities (Unity/Quantum style)
 */
export const FPVector3 = {
  // ============ Creation ============

  /** Create a new 3D vector from FixedPoint values */
  Create: (x: FixedPoint, y: FixedPoint, z: FixedPoint): FPVector3 => ({
    x,
    y,
    z,
  }),

  /** Create a 3D vector from float numbers */
  FromFloat: (x: number, y: number, z: number): FPVector3 => ({
    x: FP.FromFloat(x),
    y: FP.FromFloat(y),
    z: FP.FromFloat(z),
  }),

  // ============ Constants ============

  /** Zero vector */
  Zero: { x: FP._0, y: FP._0, z: FP._0 } as FPVector3,

  /** One vector (1, 1, 1) */
  One: { x: FP._1, y: FP._1, z: FP._1 } as FPVector3,

  /** Up direction (0, 1, 0) - Unity convention */
  Up: { x: FP._0, y: FP._1, z: FP._0 } as FPVector3,

  /** Right direction (1, 0, 0) - Unity convention */
  Right: { x: FP._1, y: FP._0, z: FP._0 } as FPVector3,

  /** Forward direction (0, 0, 1) - Unity convention */
  Forward: { x: FP._0, y: FP._0, z: FP._1 } as FPVector3,

  // ============ Operations ============

  /** Add two 3D vectors */
  Add: (a: FPVector3, b: FPVector3): FPVector3 => ({
    x: a.x.add(b.x),
    y: a.y.add(b.y),
    z: a.z.add(b.z),
  }),

  /** Subtract two 3D vectors */
  Sub: (a: FPVector3, b: FPVector3): FPVector3 => ({
    x: a.x.sub(b.x),
    y: a.y.sub(b.y),
    z: a.z.sub(b.z),
  }),

  /** Scale a 3D vector by a scalar */
  Scale: (v: FPVector3, s: FixedPoint): FPVector3 => ({
    x: v.x.mul(s),
    y: v.y.mul(s),
    z: v.z.mul(s),
  }),

  /** Get the magnitude (length) of a 3D vector - Unity naming */
  Magnitude: (v: FPVector3): FixedPoint => {
    return v.x.mul(v.x).add(v.y.mul(v.y)).add(v.z.mul(v.z)).sqrt();
  },

  /** Get the squared magnitude of a 3D vector (faster than Magnitude) - Unity naming */
  SqrMagnitude: (v: FPVector3): FixedPoint => {
    return v.x.mul(v.x).add(v.y.mul(v.y)).add(v.z.mul(v.z));
  },

  /** Normalize a 3D vector (returns new vector) */
  Normalize: (v: FPVector3): FPVector3 => {
    const len = FPVector3.Magnitude(v);
    if (len.isZero()) {
      return { x: FP._0, y: FP._0, z: FP._0 };
    }
    return {
      x: v.x.div(len),
      y: v.y.div(len),
      z: v.z.div(len),
    };
  },

  /** Dot product of two 3D vectors */
  Dot: (a: FPVector3, b: FPVector3): FixedPoint => {
    return a.x.mul(b.x).add(a.y.mul(b.y)).add(a.z.mul(b.z));
  },

  /** Cross product of two 3D vectors */
  Cross: (a: FPVector3, b: FPVector3): FPVector3 => ({
    x: a.y.mul(b.z).sub(a.z.mul(b.y)),
    y: a.z.mul(b.x).sub(a.x.mul(b.z)),
    z: a.x.mul(b.y).sub(a.y.mul(b.x)),
  }),

  /** Distance between two 3D vectors */
  Distance: (a: FPVector3, b: FPVector3): FixedPoint => {
    const dx = b.x.sub(a.x);
    const dy = b.y.sub(a.y);
    const dz = b.z.sub(a.z);
    return dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz)).sqrt();
  },

  /** Squared distance between two 3D vectors (faster than Distance) */
  SqrDistance: (a: FPVector3, b: FPVector3): FixedPoint => {
    const dx = b.x.sub(a.x);
    const dy = b.y.sub(a.y);
    const dz = b.z.sub(a.z);
    return dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz));
  },

  /** Linear interpolation between two 3D vectors */
  Lerp: (a: FPVector3, b: FPVector3, t: FixedPoint): FPVector3 => ({
    x: FP.Lerp(a.x, b.x, t),
    y: FP.Lerp(a.y, b.y, t),
    z: FP.Lerp(a.z, b.z, t),
  }),

  // ============ Conversion ============

  /** Convert to plain object with float values (for display/serialization) */
  ToFloat: (v: FPVector3): { x: number; y: number; z: number } => ({
    x: v.x.toDecimal(),
    y: v.y.toDecimal(),
    z: v.z.toDecimal(),
  }),
};

/**
 * Fixed-point quaternion interface.
 * Stored in (x, y, z, w) order where w is the scalar component.
 */
export interface FPQuaternion {
  x: FixedPoint;
  y: FixedPoint;
  z: FixedPoint;
  w: FixedPoint;
}

/**
 * FPQuaternion - Deterministic fixed-point quaternion utilities (Unity/Quantum style).
 *
 * All rotations are represented as unit quaternions. Conversions use the XYZ
 * Euler order (matching Unity's Transform), with all intermediate math kept in
 * FixedPoint for lockstep determinism.
 */
export const FPQuaternion = {
  // ============ Creation ============

  /** Identity rotation (no rotation): { 0, 0, 0, 1 } */
  Identity: (): FPQuaternion => ({ x: FP._0, y: FP._0, z: FP._0, w: FP._1 }),

  /** Create a quaternion from FixedPoint components */
  Create: (
    x: FixedPoint,
    y: FixedPoint,
    z: FixedPoint,
    w: FixedPoint,
  ): FPQuaternion => ({ x, y, z, w }),

  /** Create a quaternion from float components */
  FromFloat: (x: number, y: number, z: number, w: number): FPQuaternion => ({
    x: FP.FromFloat(x),
    y: FP.FromFloat(y),
    z: FP.FromFloat(z),
    w: FP.FromFloat(w),
  }),

  // ============ Rotation constructors ============

  /**
   * Build a yaw-only rotation (rotation about the Y axis).
   * Cardinal angles use exact quaternion components; other angles use half-angle
   * Sin/Cos (with exact trig at PI/2 half-angle for 180° yaw).
   */
  FromYaw: (yaw: FixedPoint): FPQuaternion => {
    const snapped = snapYawToCardinal(normalizeAngleRad(yaw));

    if (FP.Eq(snapped, FP._0)) {
      return FPQuaternion.Identity();
    }
    if (FP.Eq(snapped, FP.PiOver2)) {
      const quarter = FP.Mul(FP.PiOver2, FP.FromFloat(0.5));
      return FPQuaternion.Normalize({
        x: FP._0,
        y: FP.Sin(quarter),
        z: FP._0,
        w: FP.Cos(quarter),
      });
    }
    if (FP.Eq(snapped, FP.Neg(FP.PiOver2))) {
      const quarter = FP.Mul(FP.Neg(FP.PiOver2), FP.FromFloat(0.5));
      return FPQuaternion.Normalize({
        x: FP._0,
        y: FP.Sin(quarter),
        z: FP._0,
        w: FP.Cos(quarter),
      });
    }
    if (FP.Eq(snapped, FP.Pi) || FP.Eq(snapped, FP.Neg(FP.Pi))) {
      return { x: FP._0, y: FP._1, z: FP._0, w: FP._0 };
    }

    const half = FP.Mul(snapped, FP.FromFloat(0.5));
    return FPQuaternion.Normalize({
      x: FP._0,
      y: FP.Sin(half),
      z: FP._0,
      w: FP.Cos(half),
    });
  },

  /**
   * Build a rotation of `angle` radians around `axis`.
   * `axis` is assumed to be unit length (caller's responsibility).
   */
  FromAxisAngle: (axis: FPVector3, angle: FixedPoint): FPQuaternion => {
    if (
      FP.Eq(axis.x, FP._0) &&
      FP.Eq(axis.z, FP._0) &&
      !FP.Eq(axis.y, FP._0)
    ) {
      const yaw = FP.Gt(axis.y, FP._0) ? angle : FP.Neg(angle);
      return FPQuaternion.FromYaw(yaw);
    }

    const half = FP.Mul(angle, FP.FromFloat(0.5));
    const s = FP.Sin(half);
    const c = FP.Cos(half);
    return FPQuaternion.Normalize({
      x: FP.Mul(axis.x, s),
      y: FP.Mul(axis.y, s),
      z: FP.Mul(axis.z, s),
      w: c,
    });
  },

  /**
   * Build a rotation that aligns the +Z axis with `forwardDir`, using `upDir`
   * (default FPVector3.Up) as the reference up direction.
   */
  LookRotation: (
    forwardDir: FPVector3,
    upDir: FPVector3 = FPVector3.Up,
  ): FPQuaternion => {
    const forward = FPVector3.Normalize(forwardDir);
    // Degenerate forward (zero-length): Normalize yields the zero vector, so no
    // orthonormal basis exists. Fall back to a well-defined unit quaternion.
    if (FP.Eq(FPVector3.SqrMagnitude(forward), FP._0)) {
      return FPQuaternion.Identity();
    }

    let rightRaw = FPVector3.Cross(upDir, forward);
    // up parallel to forward => cross product is ~zero. Retry with an alternate
    // reference up axis guaranteed not to be parallel to a unit forward.
    if (FP.Eq(FPVector3.SqrMagnitude(rightRaw), FP._0)) {
      rightRaw = FPVector3.Cross(FPVector3.Forward, forward);
      if (FP.Eq(FPVector3.SqrMagnitude(rightRaw), FP._0)) {
        rightRaw = FPVector3.Cross(FPVector3.Right, forward);
      }
      if (FP.Eq(FPVector3.SqrMagnitude(rightRaw), FP._0)) {
        return FPQuaternion.Identity();
      }
    }
    const right = FPVector3.Normalize(rightRaw);
    const up = FPVector3.Cross(forward, right);

    // Rotation matrix columns: right (m*0), up (m*1), forward (m*2)
    const m00 = right.x;
    const m10 = right.y;
    const m20 = right.z;
    const m01 = up.x;
    const m11 = up.y;
    const m21 = up.z;
    const m02 = forward.x;
    const m12 = forward.y;
    const m22 = forward.z;

    const quarter = FP.FromFloat(0.25);
    const trace = FP.Add(FP.Add(m00, m11), m22);

    if (FP.Gt(trace, FP._0)) {
      const s = FP.Mul(FP.Sqrt(FP.Add(trace, FP._1)), FP.FromInt(2));
      return FPQuaternion.Normalize({
        w: FP.Mul(quarter, s),
        x: FP.Div(FP.Sub(m21, m12), s),
        y: FP.Div(FP.Sub(m02, m20), s),
        z: FP.Div(FP.Sub(m10, m01), s),
      });
    }

    if (FP.Gt(m00, m11) && FP.Gt(m00, m22)) {
      const s = FP.Mul(
        FP.Sqrt(FP.Add(FP.Sub(FP.Sub(FP._1, m11), m22), m00)),
        FP.FromInt(2),
      );
      return FPQuaternion.Normalize({
        w: FP.Div(FP.Sub(m21, m12), s),
        x: FP.Mul(quarter, s),
        y: FP.Div(FP.Add(m01, m10), s),
        z: FP.Div(FP.Add(m02, m20), s),
      });
    }

    if (FP.Gt(m11, m22)) {
      const s = FP.Mul(
        FP.Sqrt(FP.Add(FP.Sub(FP.Sub(FP._1, m00), m22), m11)),
        FP.FromInt(2),
      );
      return FPQuaternion.Normalize({
        w: FP.Div(FP.Sub(m02, m20), s),
        x: FP.Div(FP.Add(m01, m10), s),
        y: FP.Mul(quarter, s),
        z: FP.Div(FP.Add(m12, m21), s),
      });
    }

    const s = FP.Mul(
      FP.Sqrt(FP.Add(FP.Sub(FP.Sub(FP._1, m00), m11), m22)),
      FP.FromInt(2),
    );
    return FPQuaternion.Normalize({
      w: FP.Div(FP.Sub(m10, m01), s),
      x: FP.Div(FP.Add(m02, m20), s),
      y: FP.Div(FP.Add(m12, m21), s),
      z: FP.Mul(quarter, s),
    });
  },

  /**
   * Build a quaternion from Euler angles (radians) applied in XYZ order.
   */
  FromEulerXYZ: (euler: FPVector3): FPQuaternion => {
    if (FP.Eq(euler.x, FP._0) && FP.Eq(euler.z, FP._0)) {
      return FPQuaternion.FromYaw(euler.y);
    }

    const half = FP.FromFloat(0.5);
    const c1 = FP.Cos(FP.Mul(euler.x, half));
    const s1 = FP.Sin(FP.Mul(euler.x, half));
    const c2 = FP.Cos(FP.Mul(euler.y, half));
    const s2 = FP.Sin(FP.Mul(euler.y, half));
    const c3 = FP.Cos(FP.Mul(euler.z, half));
    const s3 = FP.Sin(FP.Mul(euler.z, half));

    return {
      x: FP.Add(FP.Mul(FP.Mul(s1, c2), c3), FP.Mul(FP.Mul(c1, s2), s3)),
      y: FP.Sub(FP.Mul(FP.Mul(c1, s2), c3), FP.Mul(FP.Mul(s1, c2), s3)),
      z: FP.Add(FP.Mul(FP.Mul(c1, c2), s3), FP.Mul(FP.Mul(s1, s2), c3)),
      w: FP.Sub(FP.Mul(FP.Mul(c1, c2), c3), FP.Mul(FP.Mul(s1, s2), s3)),
    };
  },

  /**
   * Extract Euler angles (radians, XYZ order) from a quaternion.
   * The pitch sine is clamped to [-1, 1] to avoid NaN at the gimbal poles.
   */
  ToEulerXYZ: (q: FPQuaternion): FPVector3 => {
    const two = FP.FromInt(2);
    // The matrix-extraction formulas below assume a unit quaternion.
    const { x, y, z, w } = FPQuaternion.Normalize(q);

    const m13 = FP.Mul(two, FP.Add(FP.Mul(x, z), FP.Mul(w, y)));
    const sinY = FP.Clamp(m13, FP.FromFloat(-1), FP._1);
    const cosY = FP.Sqrt(FP.Sub(FP._1, FP.Mul(sinY, sinY)));
    const yAngle = FP.Atan2(sinY, cosY);

    // Gimbal-lock epsilon: when cos(pitch) is this small the X/Z extraction
    // denominators collapse to ~0, so fall back to the stable lock branch.
    const threshold = FP.FromFloat(0.01);
    let xAngle: FixedPoint;
    let zAngle: FixedPoint;

    if (FP.Gt(cosY, threshold)) {
      const m23 = FP.Mul(two, FP.Sub(FP.Mul(y, z), FP.Mul(w, x)));
      const m33 = FP.Sub(FP._1, FP.Mul(two, FP.Add(FP.Mul(x, x), FP.Mul(y, y))));
      const m12 = FP.Mul(two, FP.Sub(FP.Mul(x, y), FP.Mul(w, z)));
      const m11 = FP.Sub(FP._1, FP.Mul(two, FP.Add(FP.Mul(y, y), FP.Mul(z, z))));
      xAngle = FP.Atan2(FP.Neg(m23), m33);
      zAngle = FP.Atan2(FP.Neg(m12), m11);
    } else {
      // Gimbal lock: fix roll at zero and derive pitch from the remaining terms.
      const m32 = FP.Mul(two, FP.Add(FP.Mul(y, z), FP.Mul(w, x)));
      const m22 = FP.Sub(FP._1, FP.Mul(two, FP.Add(FP.Mul(x, x), FP.Mul(z, z))));
      xAngle = FP.Atan2(m32, m22);
      zAngle = FP._0;
    }

    return { x: xAngle, y: yAngle, z: zAngle };
  },

  // ============ Operations ============

  /** Hamilton product a * b (applies rotation b first, then a). */
  Mul: (a: FPQuaternion, b: FPQuaternion): FPQuaternion => ({
    x: FP.Add(
      FP.Add(FP.Mul(a.w, b.x), FP.Mul(a.x, b.w)),
      FP.Sub(FP.Mul(a.y, b.z), FP.Mul(a.z, b.y)),
    ),
    y: FP.Add(
      FP.Sub(FP.Mul(a.w, b.y), FP.Mul(a.x, b.z)),
      FP.Add(FP.Mul(a.y, b.w), FP.Mul(a.z, b.x)),
    ),
    z: FP.Add(
      FP.Add(FP.Mul(a.w, b.z), FP.Mul(a.x, b.y)),
      FP.Sub(FP.Mul(a.z, b.w), FP.Mul(a.y, b.x)),
    ),
    w: FP.Sub(
      FP.Sub(FP.Mul(a.w, b.w), FP.Mul(a.x, b.x)),
      FP.Add(FP.Mul(a.y, b.y), FP.Mul(a.z, b.z)),
    ),
  }),

  /** Dot product of two quaternions. */
  Dot: (a: FPQuaternion, b: FPQuaternion): FixedPoint =>
    FP.Add(
      FP.Add(FP.Mul(a.x, b.x), FP.Mul(a.y, b.y)),
      FP.Add(FP.Mul(a.z, b.z), FP.Mul(a.w, b.w)),
    ),

  /** Magnitude (length) of a quaternion. */
  Magnitude: (q: FPQuaternion): FixedPoint =>
    FP.Sqrt(FPQuaternion.SqrMagnitude(q)),

  /** Squared magnitude of a quaternion (faster than Magnitude). */
  SqrMagnitude: (q: FPQuaternion): FixedPoint =>
    FP.Add(
      FP.Add(FP.Mul(q.x, q.x), FP.Mul(q.y, q.y)),
      FP.Add(FP.Mul(q.z, q.z), FP.Mul(q.w, q.w)),
    ),

  /** Normalize a quaternion. Returns Identity() if magnitude is zero. */
  Normalize: (q: FPQuaternion): FPQuaternion => {
    const mag = FPQuaternion.Magnitude(q);
    if (mag.isZero()) {
      return FPQuaternion.Identity();
    }
    return {
      x: FP.Div(q.x, mag),
      y: FP.Div(q.y, mag),
      z: FP.Div(q.z, mag),
      w: FP.Div(q.w, mag),
    };
  },

  /** Conjugate of a quaternion: { -x, -y, -z, w }. */
  Conjugate: (q: FPQuaternion): FPQuaternion => ({
    x: FP.Neg(q.x),
    y: FP.Neg(q.y),
    z: FP.Neg(q.z),
    w: q.w,
  }),

  /** Inverse of a quaternion: Conjugate(q) / sqrMagnitude. */
  Inverse: (q: FPQuaternion): FPQuaternion => {
    const sqrMag = FPQuaternion.SqrMagnitude(q);
    if (sqrMag.isZero()) {
      return FPQuaternion.Identity();
    }
    // Unit quaternions: inverse equals conjugate (no division rounding).
    if (FP.Eq(sqrMag, FP._1)) {
      return FPQuaternion.Conjugate(q);
    }
    const conj = FPQuaternion.Conjugate(q);
    return {
      x: FP.Div(conj.x, sqrMag),
      y: FP.Div(conj.y, sqrMag),
      z: FP.Div(conj.z, sqrMag),
      w: FP.Div(conj.w, sqrMag),
    };
  },

  // ============ Interpolation ============

  /**
   * Spherical linear interpolation between two rotations.
   * Takes the shortest arc and falls back to normalized LERP for near-parallel
   * inputs to avoid division by a near-zero sine.
   */
  Slerp: (a: FPQuaternion, b: FPQuaternion, t: FixedPoint): FPQuaternion => {
    let dot = FPQuaternion.Dot(a, b);
    let bx = b.x;
    let by = b.y;
    let bz = b.z;
    let bw = b.w;

    // Take the shortest path by flipping b when the dot product is negative.
    if (FP.Lt(dot, FP._0)) {
      bx = FP.Neg(bx);
      by = FP.Neg(by);
      bz = FP.Neg(bz);
      bw = FP.Neg(bw);
      dot = FP.Neg(dot);
    }

    // Near-parallel: normalized LERP avoids precision loss near sin(0).
    if (FP.Gte(dot, FP.FromFloat(0.9995))) {
      return FPQuaternion.Normalize({
        x: FP.Add(a.x, FP.Mul(t, FP.Sub(bx, a.x))),
        y: FP.Add(a.y, FP.Mul(t, FP.Sub(by, a.y))),
        z: FP.Add(a.z, FP.Mul(t, FP.Sub(bz, a.z))),
        w: FP.Add(a.w, FP.Mul(t, FP.Sub(bw, a.w))),
      });
    }

    const theta0 = FP.Acos(dot);
    const theta = FP.Mul(theta0, t);
    const sinTheta0 = FP.Sin(theta0);
    const s0 = FP.Div(FP.Sin(FP.Sub(theta0, theta)), sinTheta0);
    const s1 = FP.Div(FP.Sin(theta), sinTheta0);

    return FPQuaternion.Normalize({
      x: FP.Add(FP.Mul(s0, a.x), FP.Mul(s1, bx)),
      y: FP.Add(FP.Mul(s0, a.y), FP.Mul(s1, by)),
      z: FP.Add(FP.Mul(s0, a.z), FP.Mul(s1, bz)),
      w: FP.Add(FP.Mul(s0, a.w), FP.Mul(s1, bw)),
    });
  },

  /** Rotate a vector by a quaternion: q * [v, 0] * Conjugate(q). */
  RotateVector: (q: FPQuaternion, v: FPVector3): FPVector3 => {
    const vQuat: FPQuaternion = { x: v.x, y: v.y, z: v.z, w: FP._0 };
    const result = FPQuaternion.Mul(
      FPQuaternion.Mul(q, vQuat),
      FPQuaternion.Conjugate(q),
    );
    return { x: result.x, y: result.y, z: result.z };
  },

  // ============ Conversion ============

  /** Convert to a plain object with float values (for display/serialization). */
  ToFloat: (q: FPQuaternion): { x: number; y: number; z: number; w: number } => ({
    x: q.x.toDecimal(),
    y: q.y.toDecimal(),
    z: q.z.toDecimal(),
    w: q.w.toDecimal(),
  }),
};

