import { Vector3 } from '@babylonjs/core';

/**
 * Interface for entities that can receive damage
 * Follows Interface Segregation Principle
 */
export interface IDamageable {
  readonly health: number;
  readonly maxHealth: number;
  readonly position: Vector3;

  /**
   * Apply damage to this entity
   * @returns true if entity was destroyed
   */
  takeDamage(amount: number): boolean;

  /**
   * Check if entity is destroyed
   */
  isDestroyed(): boolean;
}
