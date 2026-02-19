import type { IComponent } from './Component';
import { ComponentType } from './Component';

/**
 * HealthComponent - Manages entity health and damage
 */
export class HealthComponent implements IComponent {
  public readonly type = ComponentType.Health;

  private _health: number;
  private _maxHealth: number;
  private _isDestroyed: boolean = false;

  constructor(maxHealth: number = 100) {
    this._maxHealth = maxHealth;
    this._health = maxHealth;
  }

  public get health(): number {
    return this._health;
  }

  public get maxHealth(): number {
    return this._maxHealth;
  }

  public get healthPercent(): number {
    return this._health / this._maxHealth;
  }

  public get isDestroyed(): boolean {
    return this._isDestroyed;
  }

  /**
   * Apply damage to this entity
   * @returns true if entity was destroyed by this damage
   */
  public takeDamage(amount: number): boolean {
    if (this._isDestroyed) return false;

    this._health = Math.max(0, this._health - amount);

    if (this._health <= 0) {
      this._isDestroyed = true;
      return true;
    }
    return false;
  }

  /**
   * Heal the entity
   */
  public heal(amount: number): void {
    if (this._isDestroyed) return;
    this._health = Math.min(this._maxHealth, this._health + amount);
  }

  /**
   * Reset health to max (useful for respawning)
   */
  public reset(): void {
    this._health = this._maxHealth;
    this._isDestroyed = false;
  }
}
