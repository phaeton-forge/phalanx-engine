import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';

export function fpToNumber(value: FixedPoint): number {
  return FP.ToFloat(value);
}

export function numberToFp(value: number): FixedPoint {
  return FP.FromFloat(value);
}

export function distanceSquared(
  x1: number,
  z1: number,
  x2: number,
  z2: number
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  return dx * dx + dz * dz;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
