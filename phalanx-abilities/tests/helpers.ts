import { Entity, GameWorld, ValueComponent } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import {
  createAbilitySystem,
  Cue,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  type AbilityDef,
  type AbilityHook,
  type AbilitySystem,
  type AbilityOwnerInit,
  type AbilitySystemPipeline,
  type AttributeDef,
  type AttributesState,
  type CueConfig,
  type CueContext,
  type CueEvent,
  type EffectDef,
  type GameplayCueDispatchedEvent,
  abilityOwnerOf,
  activeEffectsOf,
  attributesOf,
  gameplayTagsOf,
} from '../src';
import { GAMEPLAY_CUE_EVENT } from '../src/events';
import { manualTickProvider } from './support/manualTickProvider.js';

/** A standalone GAS component, attached without an `AbilityOwner`. */
export function standalone<T extends object>(
  component: { readonly type: symbol; create(): T },
  value: T = component.create()
): ValueComponent<T> {
  return new ValueComponent(component.type, value);
}

export function attributesValue(count: number): AttributesState {
  return {
    base: new BigInt64Array(count),
    current: new BigInt64Array(count),
    dirty: new Uint8Array(count),
  };
}

/** Trivial instant cue for tests that only need dispatch enabled. */
export class NoopCue extends Cue {
  public onSpawn(
    _event: GameplayCueDispatchedEvent,
    _context: CueContext
  ): void {}

  public override isFinished(): boolean {
    return true;
  }
}

/** Enables {@link CueDispatchSystem} without presentation side effects. */
export const DISPATCH_CUES: CueConfig = {
  'Cue.Test.Noop': () => new NoopCue(),
};

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
  cues?: CueConfig;
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
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
  const cueLog: CueEvent[] = [];
  const hasCues = opts.cues !== undefined && Object.keys(opts.cues).length > 0;

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

  if (hasCues) {
    world.eventBus.on<CueEvent>(GAMEPLAY_CUE_EVENT, (event) =>
      cueLog.push(event)
    );
  }

  world.registerSystems([...abilities.tickSystems], []);
  const abilityIds = (opts.abilities ?? []).map((def) => def.id);
  return { world, abilities, cueLog, abilityIds };
}

export function createTestWorld(opts: TestWorldOpts = {}): TestWorld {
  return createActivationWorld(opts);
}

export function addEntity(world: GameWorld): Entity {
  const entity = world.createEntity((id) => new Entity(id));
  world.entityManager.addEntity(entity);
  return entity;
}

export function equipEntity(
  world: GameWorld,
  entity: Entity,
  abilities: AbilitySystem,
  init?: AbilityOwnerInit
): void {
  const components = abilities.initComponent(init);
  entity.addComponents(components);
  if (world.entityManager.getEntity(entity.id)) {
    for (const component of components) {
      world.entityManager.onComponentAdded(entity, component.type);
    }
  }
}

export function spawnEntity(
  world: GameWorld,
  abilities: AbilitySystem,
  init?: AbilityOwnerInit
): Entity {
  const entity = world.createEntity((id) => new Entity(id));
  equipEntity(world, entity, abilities, init);
  world.entityManager.addEntity(entity);
  return entity;
}

/** Spawns an entity with every ability id from the test world (typical for activation tests). */
export function spawnCombatEntity(
  world: GameWorld,
  abilities: AbilitySystem,
  abilityIds: readonly string[],
  init?: AbilityOwnerInit
): Entity {
  return spawnEntity(world, abilities, {
    ...init,
    abilities: init?.abilities ?? abilityIds,
  });
}

/** The owner's ability set with the entity's attributes, effects and tags. */
export function gasOf(entity: Entity) {
  const owner = abilityOwnerOf(entity);
  const attributes = attributesOf(entity);
  const activeEffects = activeEffectsOf(entity);
  const tags = gameplayTagsOf(entity);
  if (
    owner === undefined ||
    attributes === undefined ||
    activeEffects === undefined ||
    tags === undefined
  ) {
    return undefined;
  }
  return { abilities: owner.abilities, attributes, activeEffects, tags };
}
