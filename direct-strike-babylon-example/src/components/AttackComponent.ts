import type { IComponent } from './Component';
import { ComponentType } from './Component';
import { Vector3 } from '@babylonjs/core';

/**
 * Attack type enum for distinguishing melee vs ranged attacks
 */
export type AttackType = 'melee' | 'ranged';

export interface AttackConfig {
  range?: number;
  detectionRange?: number;
  cooldown?: number;
  damage?: number;
  projectileSpeed?: number;
  attackType?: AttackType;
}

/**
 * AttackComponent - Manages entity attack capabilities
 */
export class AttackComponent implements IComponent {
  public readonly type = ComponentType.Attack;

  private _range: number;
  private _detectionRange: number;
  private _cooldown: number;
  private _damage: number;
  private _projectileSpeed: number;
  private _attackType: AttackType;
  private _currentCooldown: number = 0;
  private _attackOriginOffset: Vector3;

  constructor(config: AttackConfig = {}) {
    this._range = config.range ?? 8;
    this._detectionRange = config.detectionRange ?? config.range ?? 8;
    this._cooldown = config.cooldown ?? 1.0;
    this._damage = config.damage ?? 10;
    this._projectileSpeed = config.projectileSpeed ?? 40;
    // Default to ranged if projectileSpeed > 0, otherwise melee
    this._attackType =
      config.attackType ?? (config.projectileSpeed === 0 ? 'melee' : 'ranged');
    this._attackOriginOffset = Vector3.Zero();
  }

  public get range(): number {
    return this._range;
  }

  public get detectionRange(): number {
    return this._detectionRange;
  }

  public get cooldown(): number {
    return this._cooldown;
  }

  public get damage(): number {
    return this._damage;
  }

  public get projectileSpeed(): number {
    return this._projectileSpeed;
  }

  public get attackType(): AttackType {
    return this._attackType;
  }

  /**
   * Check if this is a melee attack
   */
  public get isMelee(): boolean {
    return this._attackType === 'melee';
  }

  /**
   * Check if this is a ranged attack
   */
  public get isRanged(): boolean {
    return this._attackType === 'ranged';
  }

  public get currentCooldown(): number {
    return this._currentCooldown;
  }

  public get attackOriginOffset(): Vector3 {
    return this._attackOriginOffset;
  }

  /**
   * Set the offset from entity position where projectiles spawn
   */
  public setAttackOriginOffset(offset: Vector3): void {
    this._attackOriginOffset = offset.clone();
  }

  /**
   * Check if attack is ready (cooldown complete)
   */
  public canAttack(): boolean {
    return this._currentCooldown <= 0;
  }

  /**
   * Called when attack is performed to reset cooldown
   */
  public onAttackPerformed(): void {
    this._currentCooldown = this._cooldown;
  }

  /**
   * Update cooldown timer
   */
  public updateCooldown(deltaTime: number): void {
    if (this._currentCooldown > 0) {
      this._currentCooldown = Math.max(0, this._currentCooldown - deltaTime);
    }
  }

  /**
   * Get attack origin position given entity world position
   */
  public getAttackOrigin(entityPosition: Vector3): Vector3 {
    return entityPosition.add(this._attackOriginOffset);
  }
}
