import type { TransformNode } from '@babylonjs/core';
import type { IComponent } from './Component';
import { ComponentType } from './Component';

/**
 * RotationComponent - Data container for smooth rotation interpolation
 *
 * Follows ECS pattern: stores data only, logic handled by RotationSystem
 */
export class RotationComponent implements IComponent {
  public readonly type = ComponentType.Rotation;

  // Rotation interpolation state
  public targetRotationY: number | null = null;
  public readonly rotationSpeed: number;

  // Default rotation based on team direction
  public defaultRotationY: number;

  // Reference to the transform node to rotate (usually the model root)
  public transformNode: TransformNode | null = null;

  constructor(defaultRotationY: number = 0, rotationSpeed: number = 8.0) {
    this.defaultRotationY = defaultRotationY;
    this.rotationSpeed = rotationSpeed;
  }

  /**
   * Set the transform node to apply rotation to
   */
  public setTransformNode(node: TransformNode): void {
    this.transformNode = node;
  }

  /**
   * Set target rotation for interpolation
   */
  public setTargetRotation(rotationY: number): void {
    this.targetRotationY = rotationY;
  }

  /**
   * Clear target rotation (when reached or cancelled)
   */
  public clearTarget(): void {
    this.targetRotationY = null;
  }

  /**
   * Check if currently interpolating
   */
  public get isInterpolating(): boolean {
    return this.targetRotationY !== null;
  }
}
