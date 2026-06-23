import { describe, it, expect } from 'vitest';
import { FP, FPVector3 } from '@phalanx-engine/math';
import {
  InterpolationComponent,
  INTERPOLATION_COMPONENT_TYPE,
} from '../src/components/InterpolationComponent';

describe('InterpolationComponent', () => {
  it('uses INTERPOLATION_COMPONENT_TYPE as its component type', () => {
    const interpolation = new InterpolationComponent();
    expect(interpolation.type).toBe(INTERPOLATION_COMPONENT_TYPE);
  });

  it('initializes position and rotation samples from constructor arguments', () => {
    const initialPosition = FPVector3.FromFloat(1, 2, 3);
    const initialRotation = FPVector3.FromFloat(0, 1.5, 0);
    const interpolation = new InterpolationComponent(initialPosition, initialRotation);

    expect(FP.ToFloat(interpolation.previousFpPosition.x)).toBeCloseTo(1);
    expect(FP.ToFloat(interpolation.currentFpPosition.z)).toBeCloseTo(3);
    expect(FP.ToFloat(interpolation.previousFpRotation.y)).toBeCloseTo(1.5);
    expect(FP.ToFloat(interpolation.currentFpRotation.y)).toBeCloseTo(1.5);
  });

  it('snapshot copies current position and rotation into previous', () => {
    const interpolation = new InterpolationComponent();
    const currentPosition = FPVector3.FromFloat(4, 5, 6);
    const currentRotation = FPVector3.FromFloat(0, 0.5, 0);
    interpolation.capture(currentPosition, currentRotation);

    interpolation.snapshot();

    expect(interpolation.previousFpPosition.x).toBe(currentPosition.x);
    expect(interpolation.previousFpPosition.y).toBe(currentPosition.y);
    expect(interpolation.previousFpPosition.z).toBe(currentPosition.z);
    expect(interpolation.previousFpRotation.y).toBe(currentRotation.y);
  });

  it('capture updates only current position and rotation', () => {
    const interpolation = new InterpolationComponent(
      FPVector3.FromFloat(0, 0, 0),
      FPVector3.FromFloat(0, 0, 0),
    );
    const nextPosition = FPVector3.FromFloat(7, 8, 9);
    const nextRotation = FPVector3.FromFloat(0, 1.25, 0);

    interpolation.capture(nextPosition, nextRotation);

    expect(FP.ToFloat(interpolation.previousFpPosition.x)).toBeCloseTo(0);
    expect(FP.ToFloat(interpolation.currentFpPosition.x)).toBeCloseTo(7);
    expect(FP.ToFloat(interpolation.previousFpRotation.y)).toBeCloseTo(0);
    expect(FP.ToFloat(interpolation.currentFpRotation.y)).toBeCloseTo(1.25);
  });

  it('does not expose visual presentation APIs', () => {
    const interpolation = new InterpolationComponent();
    expect('visualPosition' in interpolation).toBe(false);
    expect('active' in interpolation).toBe(false);
    expect('snapToPosition' in interpolation).toBe(false);
  });
});
