import type { IComponent } from './Component';
import { ComponentType } from './Component';
import { Vector3 } from '@babylonjs/core';

/**
 * MovementComponent - Manages entity movement capabilities
 * Stores movement intent (target position, speed) for use by PhysicsSystem
 */
export class MovementComponent implements IComponent {
  public readonly type = ComponentType.Movement;

  private _speed: number;
  private _isMoving: boolean = false;
  private _targetPosition: Vector3 = Vector3.Zero();
  private _justArrived: boolean = false; // Flag to track arrival for event emission

  constructor(speed: number = 10) {
    this._speed = speed;
  }

  public get speed(): number {
    return this._speed;
  }

  public get isMoving(): boolean {
    return this._isMoving;
  }

  public get targetPosition(): Vector3 {
    return this._targetPosition;
  }

  public setSpeed(speed: number): void {
    this._speed = speed;
  }

  /**
   * Start moving to a target position
   */
  public moveTo(target: Vector3): void {
    this._targetPosition = target.clone();
    this._isMoving = true;
    this._justArrived = false;
  }

  /**
   * Stop movement - called by PhysicsSystem when arrival threshold is reached
   */
  public stop(): void {
    if (this._isMoving) {
      this._justArrived = true;
    }
    this._isMoving = false;
  }

  /**
   * Check if the entity just arrived at its destination
   * Used by MovementSystem to emit completion events
   */
  public hasJustArrived(): boolean {
    return this._justArrived;
  }

  /**
   * Acknowledge that arrival has been processed
   */
  public acknowledgeArrival(): void {
    this._justArrived = false;
  }

  /**
   * Calculate movement for this frame (legacy method - kept for compatibility)
   * @deprecated Use PhysicsSystem for movement calculation
   * @returns The new position after movement, or null if not moving
   */
  public calculateMovement(
    currentPosition: Vector3,
    deltaTime: number
  ): Vector3 | null {
    if (!this._isMoving) return null;

    const direction = this._targetPosition.subtract(currentPosition);
    const distance = direction.length();
    const arrivalThreshold = 0.1;

    if (distance < arrivalThreshold) {
      this._isMoving = false;
      this._justArrived = true;
      return this._targetPosition.clone();
    }

    direction.normalize();
    const movement = direction.scale(this._speed * deltaTime);
    return currentPosition.add(movement);
  }
}
