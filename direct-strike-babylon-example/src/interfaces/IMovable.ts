import { Vector3 } from '@babylonjs/core';

/**
 * Interface for movable game entities
 * Follows Interface Segregation Principle
 */
export interface IMovable {
  readonly isMoving: boolean;
  readonly position: Vector3;
  readonly targetPosition: Vector3;
  readonly moveSpeed: number;
  moveTo(target: Vector3): void;
  updatePosition(newPosition: Vector3): void;
  stopMovement(): void;
}
