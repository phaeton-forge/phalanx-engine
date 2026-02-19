import type { IComponent } from './Component';
import { ComponentType } from './Component';

/**
 * AttackLockComponent - Deterministic attack timing for lockstep sync
 *
 * This component manages the attack lock timer that prevents movement
 * during attacks. It's separate from visual animation to ensure all
 * clients agree on when an entity can move, regardless of frame timing.
 *
 * Follows ECS pattern: stores data only, logic handled by systems
 */
export class AttackLockComponent implements IComponent {
  public readonly type = ComponentType.AttackLock;

  // Attack lock timer (deterministic for simulation)
  private _attackLockTimer: number = 0;
  public readonly attackLockDuration: number;

  constructor(attackLockDuration: number = 0.8) {
    this.attackLockDuration = attackLockDuration;
  }

  /**
   * Start the attack lock (called when attack is performed)
   */
  public startLock(): void {
    this._attackLockTimer = this.attackLockDuration;
  }

  /**
   * Update the attack lock timer
   * @param deltaTime Fixed timestep from simulation
   */
  public update(deltaTime: number): void {
    if (this._attackLockTimer > 0) {
      this._attackLockTimer = Math.max(0, this._attackLockTimer - deltaTime);
    }
  }

  /**
   * Check if currently locked (can't move)
   */
  public get isLocked(): boolean {
    return this._attackLockTimer > 0;
  }

  /**
   * Get remaining lock time
   */
  public get remainingTime(): number {
    return this._attackLockTimer;
  }

  /**
   * Force clear the lock (e.g., on death)
   */
  public clear(): void {
    this._attackLockTimer = 0;
  }
}
