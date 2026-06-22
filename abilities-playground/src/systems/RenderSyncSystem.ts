import { GameSystem } from 'phalanx-ecs';
import type { AbilitySystem } from 'phalanx-abilities';
import { FP } from 'phalanx-math';
import {
  ComponentType,
  DetectionRingComponent,
  HealthBarComponent,
  MeshComponent,
  TeamComponent,
  StatsComponent,
  UnitTypeComponent,
} from '../components';

export class RenderSyncSystem extends GameSystem {
  private get _abilities(): AbilitySystem { return this.abilities as AbilitySystem; }

  public override update(_deltaTime: number): void {
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
        entityMesh.root.rotation.set(
          interpolated.rotation.x,
          interpolated.rotation.y,
          interpolated.rotation.z,
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
      const detectionRing = entity.getComponent<DetectionRingComponent>(
        ComponentType.DetectionRing,
      );
      const unitType = entity.getComponent<UnitTypeComponent>(ComponentType.UnitType);
      const stats = entity.getComponent<StatsComponent>(ComponentType.UnitStats);
      const team = entity.getComponent<TeamComponent>(ComponentType.Team);
      if (!healthBar || !entityMesh || !stats || !team) continue;

      if (detectionRing && unitType) {
        const radius = FP.ToFloat(unitType.detectionRadius);
        detectionRing.root.scale.set(radius, radius, 1);
        // detectionRing.root.visible = stats.alive;
        detectionRing.root.visible = false;
      }

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
    }
  }
}
