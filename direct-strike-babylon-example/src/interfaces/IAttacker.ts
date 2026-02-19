import { Vector3 } from '@babylonjs/core';
import type { ITeamMember } from './ITeamMember';

/**
 * Interface for entities that can attack
 * Follows Interface Segregation Principle
 */
export interface IAttacker extends ITeamMember {
  readonly attackRange: number;
  readonly attackCooldown: number;
  readonly attackDamage: number;
  readonly position: Vector3;

  /**
   * Get the position from which projectiles are spawned
   */
  getAttackOrigin(): Vector3;

  /**
   * Check if this attacker can currently attack (cooldown check)
   */
  canAttack(): boolean;

  /**
   * Called when attack is performed to reset cooldown
   */
  onAttackPerformed(): void;

  /**
   * Update cooldown timer
   */
  updateCooldown(deltaTime: number): void;
}
