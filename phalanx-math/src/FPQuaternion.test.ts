import { describe, it, expect } from 'vitest';
import { FP, FPVector3, FPQuaternion } from './FixedMath.js';

describe('FPQuaternion', () => {
  it('Identity() returns { 0, 0, 0, 1 }', () => {
    const q = FPQuaternion.Identity();
    expect(FP.ToFloat(q.x)).toBeCloseTo(0);
    expect(FP.ToFloat(q.y)).toBeCloseTo(0);
    expect(FP.ToFloat(q.z)).toBeCloseTo(0);
    expect(FP.ToFloat(q.w)).toBeCloseTo(1);
  });

  it('Mul(Identity(), q) equals q', () => {
    const q = FPQuaternion.FromFloat(0.1, 0.2, 0.3, 0.4);
    const result = FPQuaternion.Mul(FPQuaternion.Identity(), q);
    expect(FP.ToFloat(result.x)).toBeCloseTo(0.1, 4);
    expect(FP.ToFloat(result.y)).toBeCloseTo(0.2, 4);
    expect(FP.ToFloat(result.z)).toBeCloseTo(0.3, 4);
    expect(FP.ToFloat(result.w)).toBeCloseTo(0.4, 4);
  });

  it('Normalize of a non-unit quaternion gives magnitude ~ 1', () => {
    const q = FPQuaternion.FromFloat(1, 2, 3, 4);
    const n = FPQuaternion.Normalize(q);
    const mag = FP.ToFloat(FPQuaternion.Magnitude(n));
    expect(mag).toBeCloseTo(1, 4);
  });

  it('Normalize of a zero quaternion returns Identity', () => {
    const q = FPQuaternion.FromFloat(0, 0, 0, 0);
    const n = FPQuaternion.Normalize(q);
    expect(FP.ToFloat(n.w)).toBeCloseTo(1);
  });

  it('Slerp at t=0 returns a, at t=1 returns Identity', () => {
    const a = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.FromFloat(1.0));
    const atZero = FPQuaternion.Slerp(a, FPQuaternion.Identity(), FP._0);
    const atOne = FPQuaternion.Slerp(a, FPQuaternion.Identity(), FP._1);

    expect(FP.ToFloat(atZero.y)).toBeCloseTo(FP.ToFloat(a.y), 3);
    expect(FP.ToFloat(atZero.w)).toBeCloseTo(FP.ToFloat(a.w), 3);

    expect(FP.ToFloat(atOne.y)).toBeCloseTo(0, 3);
    expect(FP.ToFloat(atOne.w)).toBeCloseTo(1, 3);
  });

  it('Slerp takes the shortest arc when dot < 0', () => {
    const a = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.FromFloat(0.2));
    // b is the same rotation expressed with negated components -> dot(a, b) < 0.
    const b = FPQuaternion.Create(FP.Neg(a.x), FP.Neg(a.y), FP.Neg(a.z), FP.Neg(a.w));

    const mid = FPQuaternion.Slerp(a, b, FP.FromFloat(0.5));
    // Shortest arc between a and -a is a itself (no large detour through 180°).
    expect(FP.ToFloat(mid.y)).toBeCloseTo(FP.ToFloat(a.y), 2);
    expect(FP.ToFloat(mid.w)).toBeCloseTo(FP.ToFloat(a.w), 2);
  });

  it('FromAxisAngle + RotateVector rotates Forward +90° about Y to Right', () => {
    const q = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.PiOver2);
    const rotated = FPQuaternion.RotateVector(q, FPVector3.Forward);

    expect(FP.ToFloat(rotated.x)).toBeCloseTo(1, 3);
    expect(FP.ToFloat(rotated.y)).toBeCloseTo(0, 3);
    expect(FP.ToFloat(rotated.z)).toBeCloseTo(0, 3);
  });

  it('FromAxisAngle + RotateVector rotates Forward 180° about Y to -Forward', () => {
    const q = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.Pi);
    const rotated = FPQuaternion.RotateVector(q, FPVector3.Forward);

    expect(FP.ToFloat(rotated.x)).toBeCloseTo(0, 3);
    expect(FP.ToFloat(rotated.y)).toBeCloseTo(0, 3);
    expect(FP.ToFloat(rotated.z)).toBeCloseTo(-1, 3);
  });

  it('FromYaw(PI) rotates Forward to -Forward exactly', () => {
    const q = FPQuaternion.FromYaw(FP.Pi);
    const rotated = FPQuaternion.RotateVector(q, FPVector3.Forward);

    expect(FP.Eq(rotated.x, FP._0)).toBe(true);
    expect(FP.Eq(rotated.y, FP._0)).toBe(true);
    expect(FP.Eq(rotated.z, FP.Neg(FP._1))).toBe(true);
  });

  it('Sin/Cos return exact values at cardinal angles', () => {
    expect(FP.Eq(FP.Sin(FP.PiOver2), FP._1)).toBe(true);
    expect(FP.Eq(FP.Cos(FP.PiOver2), FP._0)).toBe(true);
    expect(FP.Eq(FP.Sin(FP.Pi), FP._0)).toBe(true);
    expect(FP.Eq(FP.Cos(FP.Pi), FP.Neg(FP._1))).toBe(true);
  });

  it('FromEulerXYZ -> ToEulerXYZ round-trips (0, PI/2, 0)', () => {
    const euler = FPVector3.FromFloat(0, Math.PI / 2, 0);
    const q = FPQuaternion.FromEulerXYZ(euler);
    const back = FPQuaternion.ToEulerXYZ(q);

    expect(FP.ToFloat(back.x)).toBeCloseTo(0, 2);
    // Pitch tolerance reflects the engine's Taylor-series trig precision at the pole.
    expect(FP.ToFloat(back.y)).toBeCloseTo(Math.PI / 2, 1);
    expect(FP.ToFloat(back.z)).toBeCloseTo(0, 2);
  });

  it('LookRotation(Forward) is approximately Identity', () => {
    const q = FPQuaternion.LookRotation(FPVector3.Forward);
    expect(FP.ToFloat(q.x)).toBeCloseTo(0, 3);
    expect(FP.ToFloat(q.y)).toBeCloseTo(0, 3);
    expect(FP.ToFloat(q.z)).toBeCloseTo(0, 3);
    expect(FP.ToFloat(q.w)).toBeCloseTo(1, 3);
  });

  it('LookRotation(zero forward) returns the Identity unit quaternion', () => {
    const q = FPQuaternion.LookRotation(FPVector3.Zero);
    // Must be a valid unit quaternion, not NaN/zero.
    expect(FP.ToFloat(FPQuaternion.Magnitude(q))).toBeCloseTo(1, 4);
    expect(FP.ToFloat(q.x)).toBeCloseTo(0, 4);
    expect(FP.ToFloat(q.y)).toBeCloseTo(0, 4);
    expect(FP.ToFloat(q.z)).toBeCloseTo(0, 4);
    expect(FP.ToFloat(q.w)).toBeCloseTo(1, 4);
  });

  it('LookRotation with up parallel to forward returns a valid unit quaternion', () => {
    // forward == default up (0,1,0): cross(up, forward) is zero, exercising the fallback.
    const q = FPQuaternion.LookRotation(FPVector3.Up);
    expect(FP.ToFloat(FPQuaternion.Magnitude(q))).toBeCloseTo(1, 4);
    expect(Number.isNaN(FP.ToFloat(q.x))).toBe(false);
    expect(Number.isNaN(FP.ToFloat(q.y))).toBe(false);
    expect(Number.isNaN(FP.ToFloat(q.z))).toBe(false);
    expect(Number.isNaN(FP.ToFloat(q.w))).toBe(false);
  });

  it('LookRotation with explicit up parallel to forward stays unit length', () => {
    const q = FPQuaternion.LookRotation(FPVector3.Forward, FPVector3.Forward);
    expect(FP.ToFloat(FPQuaternion.Magnitude(q))).toBeCloseTo(1, 4);
  });

  it('Mul(q, Inverse(q)) equals Identity at cardinal yaws including PI', () => {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI, Math.PI - 0.02, Math.PI + 0.03]) {
      const q = FPQuaternion.FromYaw(FP.FromFloat(yaw));
      const product = FPQuaternion.Mul(q, FPQuaternion.Inverse(q));
      expect(FP.ToFloat(product.x)).toBeCloseTo(0, 4);
      expect(FP.ToFloat(product.y)).toBeCloseTo(0, 4);
      expect(FP.ToFloat(product.z)).toBeCloseTo(0, 4);
      expect(FP.ToFloat(product.w)).toBeCloseTo(1, 4);
    }
  });

  it('FromYaw always produces a unit quaternion', () => {
    for (const deg of [0, 10, 45, 70, 90, 135, 160, 180, 200, 270]) {
      const q = FPQuaternion.FromYaw(FP.FromFloat((deg * Math.PI) / 180));
      expect(FP.ToFloat(FPQuaternion.Magnitude(q))).toBeCloseTo(1, 4);
    }
  });

  it('Sin/Cos stay accurate at obtuse angles after range reduction', () => {
    for (const deg of [70, 110, 160]) {
      const rad = (deg * Math.PI) / 180;
      expect(FP.ToFloat(FP.Sin(FP.FromFloat(rad)))).toBeCloseTo(Math.sin(rad), 3);
      expect(FP.ToFloat(FP.Cos(FP.FromFloat(rad)))).toBeCloseTo(Math.cos(rad), 3);
    }
  });

  it('Slerp output is always unit length', () => {
    const a = FPQuaternion.FromYaw(FP.FromFloat(0.3));
    const b = FPQuaternion.FromYaw(FP.Pi);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const mid = FPQuaternion.Slerp(a, b, FP.FromFloat(t));
      expect(FP.ToFloat(FPQuaternion.Magnitude(mid))).toBeCloseTo(1, 4);
    }
  });
});
