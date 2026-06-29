import type {
  AbilityActivationContext,
  AbilitySystem,
} from '@phalanx-engine/abilities';
import type { GameWorld } from '@phalanx-engine/ecs';
import { PhysicsWorld } from '@phalanx-engine/physics';
import {
  CHAIN_LIGHTNING_JUMP_DELAY_TICKS,
  CHAIN_LIGHTNING_JUMP_RADIUS,
  CHAIN_LIGHTNING_RANDOM_JUMPS,
} from '../config/abilityDefinitions';
import { ComponentType, UnitTypeComponent } from '../components';
import { GameRandom } from '../core/GameRandom';
import {
  GameEvents,
  type ChainLightningJumpQueuedEvent,
} from '../events/GameEvents';
import { resolveChainLightning } from './ChainLightningResolver';

/**
 * Activation hook for the Volt chain-lightning ability.
 *
 * The ability is `Self`-targeted: all target selection happens here. The first
 * target is the closest hostile to the caster; subsequent targets are randomly
 * chosen by the deterministic RNG within a short jump radius. Damage effects
 * are queued with a per-jump delay so the chain unfolds over time.
 */
export const voltChainLightning = (
  ctx: AbilityActivationContext,
  world: GameWorld,
  _abilities: AbilitySystem
): void => {
  const caster = world.entityManager.getEntity(ctx.casterEntityId);
  if (!caster) return;

  const unitType = caster.getComponent<UnitTypeComponent>(
    ComponentType.UnitType
  );
  if (!unitType) return;

  const physics = world.context.physics as PhysicsWorld | undefined;
  if (!physics) return;

  if (!GameRandom.isInitialized()) return;

  const chain = resolveChainLightning(
    ctx.casterEntityId,
    CHAIN_LIGHTNING_RANDOM_JUMPS,
    unitType.detectionRadius,
    CHAIN_LIGHTNING_JUMP_RADIUS,
    physics,
    world.entityManager,
    GameRandom.rng
  );

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    const effectId =
      i === 0 ? 'Effect.Damage.Volt.Primary' : `Effect.Damage.Volt.Jump${i}`;

    const landingTick = ctx.tick + 1 + i * CHAIN_LIGHTNING_JUMP_DELAY_TICKS;

    world.eventBus.emit<ChainLightningJumpQueuedEvent>(
      GameEvents.CHAIN_LIGHTNING_JUMP_QUEUED,
      {
        dueTick: landingTick,
        targetId: link.targetId,
        effectId,
        sourceId: link.sourceId,
      }
    );
  }
};
