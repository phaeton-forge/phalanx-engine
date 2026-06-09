import { Entity, GameWorld, resetEntityIdCounter } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  createAbilitySystem,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  type AbilityDef,
  type AbilityHook,
  type AbilitySystem,
  type AbilitySystemComponentInit,
  type AbilitySystemPipeline,
  type AttributeDef,
  type CueEvent,
  type EffectDef,
} from '../src';
import { GAMEPLAY_CUE_EVENT } from '../src/events';

export const HealthAttribute = defineAttribute({
  id: 'Health',
  default: FP.FromInt(100),
  min: FP.FromInt(0),
  max: FP.FromInt(100),
  clamp: 'both',
});

export const ManaAttribute = defineAttribute({
  id: 'Mana',
  default: FP.FromInt(50),
  min: FP.FromInt(0),
  max: FP.FromInt(50),
  clamp: 'both',
});

export const ArmorAttribute = defineAttribute({
  id: 'Armor',
  default: FP.FromInt(50),
  min: FP.FromInt(0),
  max: FP.FromInt(1000),
  clamp: 'min',
});

export const IncomingDamageMultiplierAttribute = defineAttribute({
  id: 'IncomingDamageMultiplier',
  default: FP.FromInt(1),
  min: FP.FromInt(0),
  max: FP.FromInt(10),
  clamp: 'both',
});

export const ExplosionEffect = defineEffect({
  id: 'Effect.Explosion',
  type: 'Instant',
  modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-50) }],
});

export interface TestWorldOpts {
  attributes?: readonly AttributeDef[];
  effects?: readonly EffectDef[];
  abilities?: readonly AbilityDef[];
  pipeline?: AbilitySystemPipeline;
  hooks?: Record<string, AbilityHook>;
  cues?: 'buffer' | 'dispatch';
}

export interface TestWorld {
  world: GameWorld;
  abilities: AbilitySystem;
  cueLog: CueEvent[];
  /** Ability ids from `opts.abilities`, in registration order. */
  abilityIds: readonly string[];
}

/** Like {@link createTestWorld} but does not reset entity ids (for late-bound ability defs). */
export function createActivationWorld(opts: TestWorldOpts = {}): TestWorld {
  const world = new GameWorld({});
  const cueLog: CueEvent[] = [];
  const dispatchCues = opts.cues === 'dispatch';

  const abilities = createAbilitySystem(world, {
    definitions: defineAbilitySystem({
      attributes: opts.attributes ?? [HealthAttribute],
      effects: opts.effects,
      abilities: opts.abilities,
    }),
    pipeline: opts.pipeline ?? 'activation',
    hooks: opts.hooks,
    cues: opts.cues,
  });

  if (dispatchCues) {
    world.eventBus.on<CueEvent>(GAMEPLAY_CUE_EVENT, (event) => cueLog.push(event));
  }

  world.registerSystems([...abilities.tickSystems], []);
  const abilityIds = (opts.abilities ?? []).map((def) => def.id);
  return { world, abilities, cueLog, abilityIds };
}

export function createTestWorld(opts: TestWorldOpts = {}): TestWorld {
  resetEntityIdCounter();
  return createActivationWorld(opts);
}

export function addEntity(world: GameWorld): Entity {
  const entity = new Entity();
  world.entityManager.addEntity(entity);
  return entity;
}

export function equipEntity(
  world: GameWorld,
  entity: Entity,
  abilities: AbilitySystem,
  init?: AbilitySystemComponentInit
): void {
  const component = abilities.initComponent(init);
  entity.addComponent(component);
  if (world.entityManager.getEntity(entity.id)) {
    world.entityManager.onComponentAdded(entity, component.type);
  }
}

export function spawnEntity(
  world: GameWorld,
  abilities: AbilitySystem,
  init?: AbilitySystemComponentInit
): Entity {
  const entity = new Entity();
  equipEntity(world, entity, abilities, init);
  world.entityManager.addEntity(entity);
  return entity;
}

/** Spawns an entity with every ability id from the test world (typical for activation tests). */
export function spawnCombatEntity(
  world: GameWorld,
  abilities: AbilitySystem,
  abilityIds: readonly string[],
  init?: AbilitySystemComponentInit
): Entity {
  return spawnEntity(world, abilities, {
    ...init,
    abilities: init?.abilities ?? abilityIds,
  });
}
