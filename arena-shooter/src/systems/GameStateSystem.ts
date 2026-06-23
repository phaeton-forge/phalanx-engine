import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { ComponentType } from '../components/ComponentType.ts';
import type { WaveComponent } from '../components/WaveComponent.ts';
import type { EntityTypeComponent } from '../components/EntityTypeComponent.ts';
import { GameEvents, type HealthDiedEvent } from '../events/GameEvents.ts';

export class GameStateSystem extends GameSystem {
  private playerDied: boolean = false;

  public override init(context: SystemContext): void {
    super.init(context);

    this.subscribe<HealthDiedEvent>(GameEvents.HEALTH_DIED, (event) => {
      const entity = this.entityManager.getEntity(event.entityId);
      if (!entity) return;
      const entityType = entity.getComponent<EntityTypeComponent>(ComponentType.EntityType);
      if (entityType?.kind === 'player') {
        this.playerDied = true;
      }
    });
  }

  public override processTick(_tick: number): void {
    if (!this.playerDied) return;
    this.playerDied = false;

    const waveEntities = this.entityManager.queryEntities(ComponentType.Wave);
    if (waveEntities.length === 0) return;
    const wave = waveEntities[0].getComponent<WaveComponent>(ComponentType.Wave);
    if (!wave) return;

    wave.state = 'GAME_OVER';
    this.eventBus.emit(GameEvents.GAME_GAME_OVER, {});
  }
}
