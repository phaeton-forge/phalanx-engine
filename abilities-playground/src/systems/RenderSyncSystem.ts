import { GameSystem } from '@phalanx-engine/ecs';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import type * as THREE from 'three';
import { FP } from '@phalanx-engine/math';
import {
  ComponentType,
  HealAuraComponent,
  HealthBarComponent,
  MeshComponent,
  TeamComponent,
  StatsComponent,
  TurretComponent,
} from '../components';
import {
  networkConfig,
  TURRET_TURN_SPEED_RADIANS_PER_TICK,
} from '../config/constants';

/** World height of the aura ring — sits just above the ground to read as a decal. */
const AURA_RING_GROUND_Y = 0.05;

/**
 * Frame-rate independent traverse speed for the rendered turret. Matches the
 * simulation's per-tick rate so the visual never lags the authoritative aim
 * angle, while smoothing the 20 Hz steps into continuous motion.
 */
const TURRET_TRAVERSE_RADIANS_PER_SECOND =
  TURRET_TURN_SPEED_RADIANS_PER_TICK * networkConfig.tickRate;

/** Wrap an angle (radians) into (-π, π]. */
function normalizeAngle(radians: number): number {
  let angle = radians;
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle <= -Math.PI) angle += 2 * Math.PI;
  return angle;
}

export class RenderSyncSystem extends GameSystem {
  private get _abilities(): AbilitySystem { return this.abilities as AbilitySystem; }

  public override update(deltaTime: number): void {
    const meshEntities = this.entityManager.queryEntities(
      ComponentType.Mesh,
      ComponentType.Interpolation,
    );

    for (const entity of meshEntities) {
      const entityMesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
      if (!entityMesh) continue;

      const interpolated = this.physics?.getInterpolatedTransform(entity.id);
      if (interpolated) {
        entityMesh.root.position.set(
          interpolated.position.x,
          interpolated.position.y,
          interpolated.position.z,
        );
        entityMesh.root.quaternion.set(
          interpolated.rotation.x,
          interpolated.rotation.y,
          interpolated.rotation.z,
          interpolated.rotation.w,
        );
      }
    }

    const units = this.entityManager.queryEntities(
      ComponentType.HealthBar,
      ComponentType.Mesh,
      ComponentType.Team,
      ComponentType.UnitStats,
    );

    for (const entity of units) {
      const healthBar = entity.getComponent<HealthBarComponent>(ComponentType.HealthBar);
      const entityMesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
      const stats = entity.getComponent<StatsComponent>(ComponentType.UnitStats);
      const team = entity.getComponent<TeamComponent>(ComponentType.Team);
      if (!healthBar || !entityMesh || !stats || !team) continue;

      const health = this._abilities.tryGetAttribute(entity.id, 'Health')?.current;
      const maxHealth = this._abilities.tryGetAttribute(entity.id, 'MaxHealth')?.base;
      const healthRatio =
        health && maxHealth && FP.Gt(maxHealth, FP._0)
          ? Math.max(0, Math.min(1, FP.ToFloat(FP.Div(health, maxHealth))))
          : 0;

      healthBar.root.position.set(
        entityMesh.root.position.x,
        entityMesh.root.position.y + 7,
        entityMesh.root.position.z,
      );
      healthBar.root.rotation.y = team.teamId === 0 ? 0 : Math.PI;
      healthBar.fill.scale.x = healthRatio;
      healthBar.fill.position.x = ((healthRatio - 1) * healthBar.fullWidth) / 2;
      entityMesh.root.visible = stats.alive;
      healthBar.root.visible = stats.alive;

      const aura = entity.getComponent<HealAuraComponent>(ComponentType.HealAura);

      if (aura?.auraRing) {
        aura.auraRing.position.set(
          entityMesh.root.position.x,
          AURA_RING_GROUND_Y,
          entityMesh.root.position.z,
        );
        aura.auraRing.visible = stats.alive;
      }
    }

    this.syncTurrets(deltaTime);
  }

  /**
   * Drive each turreted model's turret node toward the simulated aim angle
   * ({@link TurretComponent.yaw}), layered on top of the model's authored rest
   * yaw. The hull quaternion is applied to the mesh root above, so this local
   * yaw composes into the world-space aim direction.
   */
  private syncTurrets(deltaTime: number): void {
    const turretedUnits = this.entityManager.queryEntities(
      ComponentType.Mesh,
      ComponentType.Turret,
    );

    for (const entity of turretedUnits) {
      const entityMesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
      const turret = entity.getComponent<TurretComponent>(ComponentType.Turret);
      const node = entityMesh?.root.userData.turret as
        | THREE.Object3D
        | undefined;
      if (!turret || !node) continue;

      const restYaw = (node.userData.restLocalYaw as number | undefined) ?? 0;
      const current = normalizeAngle(node.rotation.y - restYaw);
      const delta = normalizeAngle(FP.ToFloat(turret.yaw) - current);
      const maxStep = TURRET_TRAVERSE_RADIANS_PER_SECOND * deltaTime;
      const step =
        Math.abs(delta) <= maxStep ? delta : Math.sign(delta) * maxStep;

      node.rotation.y = restYaw + normalizeAngle(current + step);
    }
  }
}
