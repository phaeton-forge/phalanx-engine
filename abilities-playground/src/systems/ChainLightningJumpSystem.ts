import { GameSystem, type Entity, type SystemContext } from '@phalanx-engine/ecs';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import { ComponentType, StatsComponent } from '../components';
import {
  GameEvents,
  type ChainLightningJumpQueuedEvent,
} from '../events/GameEvents';

interface PendingJump {
  dueTick: number;
  targetId: number;
  effectId: string;
  sourceId: number;
}

/**
 * Applies queued chain-lightning jumps on their scheduled ticks.
 *
 * The activation hook resolves the full target chain and emits one event per
 * link. The primary link is still scheduled for the next tick (same as before),
 * while successive jumps are spaced by {@link CHAIN_LIGHTNING_JUMP_DELAY_TICKS}.
 */
export class ChainLightningJumpSystem extends GameSystem {
  private get _abilities(): AbilitySystem {
    return this.abilities as AbilitySystem;
  }

  private readonly pending: PendingJump[] = [];

  public override init(context: SystemContext): void {
    super.init(context);
    this.subscribe<ChainLightningJumpQueuedEvent>(
      GameEvents.CHAIN_LIGHTNING_JUMP_QUEUED,
      ({ dueTick, targetId, effectId, sourceId }) => {
        this.pending.push({ dueTick, targetId, effectId, sourceId });
      }
    );
  }

  public override processTick(tick: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const jump = this.pending[i];
      if (tick < jump.dueTick) continue;

      const target = this.entityManager.getEntity(jump.targetId);
      if (!target || !this.isAlive(target)) {
        this.pending.splice(i, 1);
        continue;
      }

      this._abilities.applyEffect(jump.targetId, jump.effectId, jump.sourceId);
      this.pending.splice(i, 1);
    }
  }

  private isAlive(target: Entity): boolean {
    const stats = target.getComponent<StatsComponent>(ComponentType.UnitStats);
    return stats?.alive ?? true;
  }
}
