import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './ComponentType.ts';
import { WEAPON_MAX_AMMO, WEAPON_RELOAD_TICKS } from '../config/constants.ts';

export class WeaponComponent implements IComponent {
  public readonly type = ComponentType.Weapon;

  public ammo: number = WEAPON_MAX_AMMO;
  public maxAmmo: number = WEAPON_MAX_AMMO;
  public isReloading: boolean = false;
  public reloadTimer: number = 0;
  public reloadDuration: number = WEAPON_RELOAD_TICKS;
  public firedThisTick: boolean = false;
}
