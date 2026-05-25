import { GameSystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { AbilitySystem } from 'phalanx-abilities';
import {
  ComponentType,
  HealthBarComponent,
  RenderRefsComponent,
  TeamComponent,
  UnitStatsComponent,
} from '../components';

export class RenderSyncSystem extends GameSystem {
  private abilities: AbilitySystem | null = null;

  setAbilitySystem(abilities: AbilitySystem): void {
    this.abilities = abilities;
  }

  public override update(_deltaTime: number): void {
    const entities = this.entityManager.queryEntities(
      ComponentType.HealthBar,
      ComponentType.RenderRefs,
      ComponentType.Team,
      ComponentType.UnitStats,
    );

    for (const entity of entities) {
      const healthBar = entity.getComponent<HealthBarComponent>(ComponentType.HealthBar);
      const renderRefs = entity.getComponent<RenderRefsComponent>(ComponentType.RenderRefs);
      const stats = entity.getComponent<UnitStatsComponent>(ComponentType.UnitStats);
      const team = entity.getComponent<TeamComponent>(ComponentType.Team);
      if (!healthBar || !renderRefs || !stats || !team) continue;

      const health = this.abilities?.tryGetAttribute(entity.id, 'Health')?.current;
      const maxHealth = this.abilities?.tryGetAttribute(entity.id, 'MaxHealth')?.base;
      const healthRatio =
        health && maxHealth && FP.Gt(maxHealth, FP._0)
          ? Math.max(0, Math.min(1, FP.ToFloat(FP.Div(health, maxHealth))))
          : 0;

      healthBar.root.position.set(
        renderRefs.root.position.x,
        renderRefs.root.position.y + 7,
        renderRefs.root.position.z,
      );
      healthBar.root.rotation.y = team.teamId === 0 ? 0 : Math.PI;
      healthBar.fill.scale.x = healthRatio;
      healthBar.fill.position.x = ((healthRatio - 1) * healthBar.fullWidth) / 2;
      renderRefs.root.visible = stats.alive;
      healthBar.root.visible = stats.alive;
    }
  }
}
