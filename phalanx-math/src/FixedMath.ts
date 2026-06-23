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
    // Normalize to [-PI, PI] range
    const twoPi = FP.Pi2;
    const pi = FP.Pi;

    // Simple modulo approximation
    let normalized = x;
    while (normalized.gt(pi)) {
      normalized = normalized.sub(twoPi);
    }
    while (normalized.lt(pi.neg())) {
      normalized = normalized.add(twoPi);
    }

    // Taylor series: sin(x) ≈ x - x³/3! + x⁵/5! - x⁷/7!
    const x2 = normalized.mul(normalized);
    const x3 = x2.mul(normalized);
    const x5 = x3.mul(x2);
    const x7 = x5.mul(x2);

    const fact3 = FP.FromInt(6);
    const fact5 = FP.FromInt(120);
    const fact7 = FP.FromInt(5040);

    return normalized.sub(x3.div(fact3)).add(x5.div(fact5)).sub(x7.div(fact7));
  },

  /**
   * Cosine approximation using Taylor series (deterministic)
   * Note: Input should be in radians
   */
  Cos: (x: FixedPoint): FixedPoint => {
    // cos(x) = sin(x + PI/2)
    return FP.Sin(x.add(FP.PiOver2));
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
};

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

