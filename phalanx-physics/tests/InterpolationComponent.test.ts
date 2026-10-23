import { describe, it, expect } from 'vitest';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import {
  Interpolation,
  INTERPOLATION_COMPONENT_TYPE,
  captureInterpolation,
  createInterpolationSample,
  snapshotInterpolation,
} from '../src/components/interpolation';

describe('Interpolation', () => {
  it('uses INTERPOLATION_COMPONENT_TYPE as its component type', () => {
    expect(Interpolation.type).toBe(INTERPOLATION_COMPONENT_TYPE);
  });

  it('defaults rotation samples to the identity quaternion', () => {
    const interpolation = createInterpolationSample();
    expect(FP.ToFloat(interpolation.previousFpRotation.w)).toBeCloseTo(1);
    expect(FP.ToFloat(interpolation.currentFpRotation.w)).toBeCloseTo(1);
  });

  it('initializes position and rotation samples from arguments', () => {
    const initialPosition = FPVector3.FromFloat(1, 2, 3);
    const initialRotation = FPQuaternion.FromAxisAngle(
      FPVector3.Up,
      FP.FromFloat(1.5)
    );
    const interpolation = createInterpolationSample(
      initialPosition,
      initialRotation
    );

    expect(FP.ToFloat(interpolation.previousFpPosition.x)).toBeCloseTo(1);
    expect(FP.ToFloat(interpolation.currentFpPosition.z)).toBeCloseTo(3);
    expect(interpolation.previousFpRotation.y).toEqual(initialRotation.y);
    expect(interpolation.currentFpRotation.w).toEqual(initialRotation.w);
  });

  it('snapshot copies current position and rotation into previous', () => {
    const interpolation = createInterpolationSample();
    const currentPosition = FPVector3.FromFloat(4, 5, 6);
    const currentRotation = FPQuaternion.FromAxisAngle(
      FPVector3.Up,
      FP.FromFloat(0.5)
    );
    captureInterpolation(interpolation, currentPosition, currentRotation);
    snapshotInterpolation(interpolation);

    expect(interpolation.previousFpPosition.x).toBe(currentPosition.x);
    expect(interpolation.previousFpPosition.y).toBe(currentPosition.y);
    expect(interpolation.previousFpPosition.z).toBe(currentPosition.z);
    expect(interpolation.previousFpRotation.y).toBe(currentRotation.y);
    expect(interpolation.previousFpRotation.w).toBe(currentRotation.w);
  });

  it('capture updates only current position and rotation', () => {
    const interpolation = createInterpolationSample(
      FPVector3.FromFloat(0, 0, 0),
      FPQuaternion.Identity()
    );
    const nextPosition = FPVector3.FromFloat(7, 8, 9);
    const nextRotation = FPQuaternion.FromAxisAngle(
      FPVector3.Up,
      FP.FromFloat(1.25)
    );
    captureInterpolation(interpolation, nextPosition, nextRotation);

    expect(FP.ToFloat(interpolation.previousFpPosition.x)).toBeCloseTo(0);
    expect(FP.ToFloat(interpolation.currentFpPosition.x)).toBeCloseTo(7);
    expect(FP.ToFloat(interpolation.previousFpRotation.w)).toBeCloseTo(1);
    expect(interpolation.currentFpRotation.y).toEqual(nextRotation.y);
  });
});
