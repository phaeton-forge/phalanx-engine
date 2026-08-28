import { describe, it, expect } from 'vitest';
import { FP } from './FixedMath.js';

describe('FP.ToInt', () => {
  it('extracts a positive integer-valued FixedPoint exactly', () => {
    expect(FP.ToInt(FP.FromInt(0))).toBe(0);
    expect(FP.ToInt(FP.FromInt(1))).toBe(1);
    expect(FP.ToInt(FP.FromInt(3))).toBe(3);
    expect(FP.ToInt(FP.FromInt(4))).toBe(4);
  });

  it('extracts a negative integer-valued FixedPoint exactly', () => {
    expect(FP.ToInt(FP.FromInt(-1))).toBe(-1);
    expect(FP.ToInt(FP.FromInt(-18))).toBe(-18);
    expect(FP.ToInt(FP.FromInt(-27))).toBe(-27);
  });

  it('rounds toward zero (Math.trunc semantics) for fractional values', () => {
    expect(FP.ToInt(FP.FromFloat(2.9))).toBe(2);
    expect(FP.ToInt(FP.FromFloat(-2.9))).toBe(-2);
    expect(FP.ToInt(FP.FromFloat(0.99999))).toBe(0);
    expect(FP.ToInt(FP.FromFloat(-0.99999))).toBe(0);
  });

  it('is the exact inverse of FromInt for integers in range', () => {
    for (const n of [0, 1, 5, 42, 255, 1000, -1, -100]) {
      expect(FP.ToInt(FP.FromInt(n))).toBe(n);
    }
  });

  it('handles large integers without precision loss', () => {
    // Well within the i64 fixed-point range; ToInt must stay exact.
    expect(FP.ToInt(FP.FromInt(1_000_000))).toBe(1_000_000);
    expect(FP.ToInt(FP.FromInt(-1_000_000))).toBe(-1_000_000);
  });

  it('never performs a float round-trip: matches raw bigint division', () => {
    // The contract: ToInt == floor-toward-zero of the raw base / scale.
    // Using FromFloat to construct a value with a known fractional part.
    const fp = FP.FromFloat(7.3);
    const raw = FP.ToRaw(fp);
    const scale = 100000n; // 10^DEFAULT_PRECISION (5)
    expect(FP.ToInt(fp)).toBe(Number(raw / scale));
  });

  it('agrees with Math.trunc(ToFloat) for typical ability levels', () => {
    // Levels 1..4 are the drone-survival ability-level attribute range.
    for (const level of [1, 2, 3, 4]) {
      const fp = FP.FromInt(level);
      expect(FP.ToInt(fp)).toBe(Math.trunc(FP.ToFloat(fp)));
    }
  });
});
