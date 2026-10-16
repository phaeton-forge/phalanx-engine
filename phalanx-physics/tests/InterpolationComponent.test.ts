import { describe, it, expect } from 'vitest';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import {
  InterpolationComponent,
  INTERPOLATION_COMPONENT_TYPE,
} from '../src/components/InterpolationComponent';

describe('InterpolationComponent', () => {
  it('uses INTERPOLATION_COMPONENT_TYPE as its component type', () => {
    const interpolation = new InterpolationComponent();
    expect(interpolation.type).toBe(INTERPOLATION_COMPONENT_TYPE);
  });

  it('defaults rotation samples to the identity quaternion', () => {
    const interpolation = new InterpolationComponent();
    expect(FP.ToFloat(interpolation.previousFpRotation.w)).toBeCloseTo(1);
    expect(FP.ToFloat(interpolation.currentFpRotation.w)).toBeCloseTo(1);
  });

  it('initializes position and rotation samples from constructor arguments', () => {
    const initialPosition = FPVector3.FromFloat(1, 2, 3);
    const initialRotation = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.FromFloat(1.5));
    const interpolation = new InterpolationComponent(initialPosition, initialRotation);

    expect(FP.ToFloat(interpolation.previousFpPosition.x)).toBeCloseTo(1);
    expect(FP.ToFloat(interpolation.currentFpPosition.z)).toBeCloseTo(3);
    expect(interpolation.previousFpRotation.y).toEqual(initialRotation.y);
    expect(interpolation.currentFpRotation.w).toEqual(initialRotation.w);
  });

  it('snapshot copies current position and rotation into previous', () => {
    const interpolation = new InterpolationComponent();
    const currentPosition = FPVector3.FromFloat(4, 5, 6);
    const currentRotation = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.FromFloat(0.5));
    interpolation.capture(currentPosition, currentRotation);

    interpolation.snapshot();

    expect(interpolation.previousFpPosition.x).toBe(currentPosition.x);
    expect(interpolation.previousFpPosition.y).toBe(currentPosition.y);
    expect(interpolation.previousFpPosition.z).toBe(currentPosition.z);
    expect(interpolation.previousFpRotation.y).toBe(currentRotation.y);
    expect(interpolation.previousFpRotation.w).toBe(currentRotation.w);
  });

  it('capture updates only current position and rotation', () => {
    const interpolation = new InterpolationComponent(
      FPVector3.FromFloat(0, 0, 0),
      FPQuaternion.Identity(),
    );
    const nextPosition = FPVector3.FromFloat(7, 8, 9);
    const nextRotation = FPQuaternion.FromAxisAngle(FPVector3.Up, FP.FromFloat(1.25));

    interpolation.capture(nextPosition, nextRotation);

    expect(FP.ToFloat(interpolation.previousFpPosition.x)).toBeCloseTo(0);
    expect(FP.ToFloat(interpolation.currentFpPosition.x)).toBeCloseTo(7);
    // previous rotation untouched -> still identity
    expect(FP.ToFloat(interpolation.previousFpRotation.w)).toBeCloseTo(1);
    expect(interpolation.currentFpRotation.y).toEqual(nextRotation.y);
  });

  it('does not expose visual presentation APIs', () => {
    const interpolation = new InterpolationComponent();
    expect('visualPosition' in interpolation).toBe(false);
    expect('active' in interpolation).toBe(false);
    expect('snapToPosition' in interpolation).toBe(false);
  });
});
