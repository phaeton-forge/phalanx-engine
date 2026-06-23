import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { FP, FPVector3 } from '@phalanx-engine/math';
import { ComponentType } from '../components/ComponentType.ts';
import type { PlayerInputComponent } from '../components/PlayerInputComponent.ts';
import type { WeaponComponent } from '../components/WeaponComponent.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';
import type { EntityFactory } from '../core/EntityFactory.ts';
import type { WaveComponent } from '../components/WaveComponent.ts';
import { GameEvents, type WeaponFiredEvent } from '../events/GameEvents.ts';

export class WeaponSystem extends GameSystem {
  private entityFactory: EntityFactory;
  constructor(entityFactory: EntityFactory) {
    super();
    this.entityFactory = entityFactory;
  }

  public override init(context: SystemContext): void {
    super.init(context);
  }

  public override processTick(_tick: number): void {
    // Check game state
    const waveEntities = this.entityManager.queryEntities(ComponentType.Wave);
    if (waveEntities.length > 0) {
      const wave = waveEntities[0].getComponent<WaveComponent>(ComponentType.Wave);
      if (wave && (wave.state === 'GAME_OVER' || wave.state === 'VICTORY' || wave.state === 'LOADING')) {
        return;
      }
    }

    const entities = this.entityManager.queryEntities(ComponentType.PlayerInput, ComponentType.Weapon);
    for (const entity of entities) {
      const input = entity.getComponent<PlayerInputComponent>(ComponentType.PlayerInput);
      const weapon = entity.getComponent<WeaponComponent>(ComponentType.Weapon);
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!input || !weapon || !transform) continue;

      weapon.firedThisTick = false;

      // Handle reload
      if (weapon.isReloading) {
        weapon.reloadTimer--;
        if (weapon.reloadTimer <= 0) {
          weapon.isReloading = false;
          weapon.ammo = weapon.maxAmmo;
          this.eventBus.emit(GameEvents.WEAPON_RELOAD_COMPLETE, {});
        }
        continue;
      }

      // Manual reload request
      if (input.isReloading && weapon.ammo < weapon.maxAmmo) {
        this.startReload(weapon);
        continue;
      }

      // Fire
      if (input.isFiring && weapon.ammo > 0) {
        weapon.ammo--;
        weapon.firedThisTick = true;

        const pos = transform.fpPosition;
        const rot = transform.fpRotationY;

        // Fire origin: 0.9 units ahead of player centre
        const offsetDist = FP.FromFloat(0.9);
        const sinR = FP.Sin(rot);
        const cosR = FP.Cos(rot);
        const originX = FP.Add(pos.x, FP.Mul(sinR, offsetDist));
        const originZ = FP.Add(pos.z, FP.Mul(cosR, offsetDist));

        // Direction towards aim point
        const aimX = input.aimX;
        const aimZ = input.aimZ;
        const dx = FP.Sub(aimX, originX);
        const dz = FP.Sub(aimZ, originZ);
        const rawDir = FPVector3.Create(dx, FP._0, dz);

        // Deadzone: if aim point ≈ origin, use player's facing direction instead
        if (FPVector3.SqrMagnitude(rawDir).isZero()) {
          rawDir.x = sinR;
          rawDir.z = cosR;
        }

        const dirVec = FPVector3.Normalize(rawDir);

        this.entityFactory.createProjectile(originX, originZ, dirVec.x, dirVec.z, entity.id);

        this.eventBus.emit<WeaponFiredEvent>(GameEvents.WEAPON_FIRED, {
          originX: FP.ToFloat(originX),
          originZ: FP.ToFloat(originZ),
          dirX: FP.ToFloat(dirVec.x),
          dirZ: FP.ToFloat(dirVec.z),
        });

        // Auto-reload when empty
        if (weapon.ammo <= 0) {
          this.startReload(weapon);
        }
      }
    }
  }

  private startReload(weapon: WeaponComponent): void {
    weapon.isReloading = true;
    weapon.reloadTimer = weapon.reloadDuration;
    this.eventBus.emit(GameEvents.WEAPON_RELOAD_START, {});
  }
}
