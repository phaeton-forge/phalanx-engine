import { afterEach, describe, expect, it } from 'vitest';
import {
  BinaryStateReader,
  BinaryStateWriter,
  Entity,
  GameWorld,
  ValueComponent,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  abilityOwnerOf,
  type AbilitySystem,
  type AbilitySystemPipeline,
  ActiveEffects,
  activeEffectsOf,
  attributesOf,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  gameplayTagsOf,
  type MagnitudeCalculation,
  Attributes,
  type AttributesState,
} from '../src/index.js';
import { readAbilities, writeAbilities } from '../src/save/abilities.js';
import { attributesValue, standalone } from './helpers.js';
import { manualTickProvider } from './support/manualTickProvider.js';

const ENTITY_COUNT = 20;
const LARGE_EFFECT_COUNT = 200_000;
const WARMUP_TICKS = 30;
const CONTINUATION_TICKS = 100;

const bonusDamage: MagnitudeCalculation = (ctx) => {
  const raw = ctx.setByCaller?.get('bonus');
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    return ctx.baseMagnitude;
  }
  return FP.Add(ctx.baseMagnitude, FP.FromInt(raw));
};

const Health = defineAttribute({
  id: 'Health',
  default: FP.FromInt(100),
  min: FP.FromInt(0),
  max: FP.FromInt(100),
  clamp: 'both',
});

const Armor = defineAttribute({
  id: 'Armor',
  default: FP.FromInt(10),
  min: FP.FromInt(0),
  max: FP.FromInt(100),
  clamp: 'min',
});

const Burn = defineEffect({
  id: 'Effect.Burn',
  type: 'Periodic',
  durationTicks: 40,
  periodTicks: 5,
  modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-2) }],
  tagsGranted: ['State.Debuff.Burn'],
});

const ArmorShred = defineEffect({
  id: 'Effect.ArmorShred',
  type: 'Duration',
  durationTicks: 25,
  modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-3) }],
  tagsGranted: ['State.Debuff.ArmorShred'],
});

const Shield = defineEffect({
  id: 'Effect.Shield',
  type: 'Duration',
  durationTicks: 15,
  tagsGranted: ['State.Buff.Shield'],
  tagsBlocked: ['State.Buff.Shield'],
});

const StrikeCooldown = defineEffect({
  id: 'Effect.Strike.Cooldown',
  type: 'Duration',
  durationTicks: 8,
  tagsGranted: ['Cooldown.Ability.Strike'],
});

const StrikeDamage = defineEffect({
  id: 'Effect.Strike.Damage',
  type: 'Instant',
  modifiers: [
    {
      attributeId: 'Health',
      op: 'Add',
      magnitude: FP.FromInt(-7),
      calculation: bonusDamage,
    },
  ],
});

const CueMark = defineEffect({
  id: 'Effect.Cue',
  type: 'Instant',
  cues: ['Cue.Test'],
});

const Strike = defineAbility({
  id: 'Ability.Strike',
  cooldownEffectId: 'Effect.Strike.Cooldown',
  activationBlockedTags: ['Cooldown.Ability.Strike'],
  target: { kind: 'Entity', origin: { kind: 'Caller' } },
  targetEffectIds: ['Effect.Strike.Damage'],
});

const BurnAbility = defineAbility({
  id: 'Ability.Burn',
  target: { kind: 'Entity', origin: { kind: 'Caller' } },
  targetEffectIds: ['Effect.Burn'],
});

const definitions = defineAbilitySystem({
  attributes: [Health, Armor],
  effects: [Burn, ArmorShred, Shield, StrikeCooldown, StrikeDamage],
  abilities: [Strike, BurnAbility],
});

function finish(fill: (w: BinaryStateWriter) => void): Uint8Array {
  const writer = new BinaryStateWriter();
  fill(writer);
  return writer.finish();
}

function saveGas(world: GameWorld): Uint8Array {
  return finish((writer) => {
    writeAbilities(writer, world);
  });
}

function loadGas(bytes: Uint8Array, world: GameWorld): void {
  const reader = new BinaryStateReader(bytes);
  readAbilities(reader, world);
  reader.done();
}

function makeWorld(pipeline: AbilitySystemPipeline = 'full'): {
  world: GameWorld;
  abilities: AbilitySystem;
} {
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
  const abilities = createAbilitySystem(world, { definitions, pipeline });
  world.registerSystems([...abilities.tickSystems], []);
  return { world, abilities };
}

function standaloneAttributes(): ValueComponent<AttributesState> {
  const attributes = attributesValue(2);
  const defaults = [Health.default, Armor.default];
  for (let index = 0; index < defaults.length; index += 1) {
    const value = defaults[index];
    if (value === undefined) throw new Error('missing attribute default');
    const raw = FP.ToRaw(value);
    attributes.base[index] = raw;
    attributes.current[index] = raw;
    attributes.dirty[index] = 1;
  }
  return standalone(Attributes, attributes);
}

function at(entities: readonly Entity[], index: number): Entity {
  const entity = entities[index];
  if (entity === undefined) {
    throw new Error(`missing entity ${String(index)}`);
  }
  return entity;
}

function spawnShells(world: GameWorld, abilities: AbilitySystem): Entity[] {
  const entities: Entity[] = [];
  for (let index = 0; index < ENTITY_COUNT; index += 1) {
    const entity = world.createEntity((id) => new Entity(id));
    if (index < 12) {
      const granted =
        index % 2 === 0
          ? ['Ability.Strike', 'Ability.Burn']
          : ['Ability.Burn', 'Ability.Strike'];
      const tags =
        index % 3 === 0 ? ['Team.Red', 'Role.Caster'] : ['Team.Blue'];
      entity.addComponent(
        abilities.initComponent({
          abilities: granted,
          tags,
          attributes: {
            Health: FP.FromInt(70 + index),
            Armor: FP.FromInt(5 + index),
          },
        })
      );
    } else if (index < 16) {
      entity.addComponent(standaloneAttributes());
    }
    world.entityManager.addEntity(entity);
    entities.push(entity);
  }
  for (let index = 16; index < ENTITY_COUNT; index += 1) {
    const entity = at(entities, index);
    abilities.addTag(entity.id, index % 2 === 0 ? 'Team.Red' : 'Team.Blue');
    abilities.addTag(entity.id, 'Role.Spare');
  }
  return entities;
}

function drive(
  world: GameWorld,
  abilities: AbilitySystem,
  entities: readonly Entity[],
  tick: number
): void {
  const caster = at(entities, tick % 12);
  const target = at(entities, (tick * 3) % ENTITY_COUNT);
  if (tick % 2 === 0) {
    abilities.activateAbility(caster.id, 'Ability.Strike', {
      entityId: target.id,
    });
  } else {
    abilities.activateAbility(caster.id, 'Ability.Burn', {
      entityId: target.id,
    });
  }
  if (tick % 5 === 0) {
    const shredded = at(entities, 12 + (tick % 4));
    abilities.applyEffect(shredded.id, 'Effect.ArmorShred', caster.id);
  }
  if (tick === 4) {
    const shielded = at(entities, 13);
    abilities.applyEffect(shielded.id, 'Effect.Shield', caster.id);
    abilities.applyEffect(shielded.id, 'Effect.Shield', caster.id);
  }
  world.processAllTicks(tick);
}

describe('ability state helpers', () => {
  it('registers the abilities section once', () => {
    const { world } = makeWorld();
    expect(world.saveSections.map((section) => section.key)).toEqual([
      'abilities',
    ]);
    expect(world.saveSections[0]?.version).toBe(1);
  });

  it('throws when the world has no ability system', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    expect(() => saveGas(world)).toThrow(
      /writeAbilities: world has no ability system/
    );
    const bytes = finish((writer) => {
      writer.section('gas', 1, () => {});
    });
    expect(() => loadGas(bytes, world)).toThrow(
      /readAbilities: world has no ability system/
    );
  });

  it('throws on an unsupported setByCaller value', () => {
    const { world, abilities } = makeWorld();
    const entity = world.createEntity((id) => new Entity(id));
    entity.addComponent(abilities.initComponent({}));
    world.entityManager.addEntity(entity);
    abilities.applyEffect(
      entity.id,
      'Effect.Strike.Damage',
      entity.id,
      new Map<string, unknown>([['bad', { nope: true }]])
    );
    expect(() => saveGas(world)).toThrow(
      /unsupported setByCaller value for 'bad'/
    );

    const fractional = makeWorld();
    const other = fractional.world.createEntity((id) => new Entity(id));
    other.addComponent(fractional.abilities.initComponent({}));
    fractional.world.entityManager.addEntity(other);
    fractional.abilities.applyEffect(
      other.id,
      'Effect.Strike.Damage',
      other.id,
      new Map<string, unknown>([['bad', 1.5]])
    );
    expect(() => saveGas(fractional.world)).toThrow(
      /unsupported setByCaller value for 'bad'/
    );
  });

  it('round-trips setByCaller values and sorts keys', () => {
    const inserted = new Map<string, unknown>([
      ['zeta', 'tail'],
      ['alpha', 4],
      ['mid', 9n],
      ['flag', true],
      ['scale', FP.FromInt(2, 3)],
    ]);
    const reversed = new Map<string, unknown>([
      ['scale', FP.FromInt(2, 3)],
      ['flag', true],
      ['mid', 9n],
      ['alpha', 4],
      ['zeta', 'tail'],
    ]);

    function pendingWorld(payload: Map<string, unknown>): GameWorld {
      const { world, abilities } = makeWorld();
      const entity = world.createEntity((id) => new Entity(id));
      entity.addComponent(abilities.initComponent({}));
      world.entityManager.addEntity(entity);
      abilities.applyEffect(entity.id, 'Effect.Strike.Damage', -1, payload);
      return world;
    }

    const source = pendingWorld(inserted);
    const other = pendingWorld(reversed);
    const bytes = saveGas(source);
    expect(saveGas(other)).toEqual(bytes);

    const restored = makeWorld();
    const entity = restored.world.createEntity((id) => new Entity(id));
    entity.addComponent(restored.abilities.initComponent({}));
    restored.world.entityManager.addEntity(entity);
    loadGas(bytes, restored.world);
    expect(saveGas(restored.world)).toEqual(bytes);

    const effects = abilityOwnerOf(entity)?.activeEffects;
    const payload = effects?.pendingAdd[0]?.setByCaller;
    expect(payload).toBeInstanceOf(Map);
    if (!(payload instanceof Map)) {
      throw new Error('missing setByCaller');
    }
    expect(Array.from(payload.keys())).toEqual([
      'alpha',
      'flag',
      'mid',
      'scale',
      'zeta',
    ]);
    expect(payload.get('alpha')).toBe(4);
    expect(payload.get('mid')).toBe(9n);
    expect(payload.get('zeta')).toBe('tail');
    expect(payload.get('flag')).toBe(true);
    const scale = payload.get('scale');
    expect(
      FP.Eq(scale as ReturnType<typeof FP.FromInt>, FP.FromInt(2, 3))
    ).toBe(true);
  });

  it('writes the same bytes whatever order tags were inserted in', () => {
    function bytesFor(order: readonly string[]): Uint8Array {
      const { world, abilities } = makeWorld();
      const entity = world.createEntity((id) => new Entity(id));
      entity.addComponent(abilities.initComponent({ tags: order }));
      world.entityManager.addEntity(entity);
      const tags = gameplayTagsOf(entity);
      if (tags === undefined) throw new Error('missing tags');
      for (const tag of order) tags.effectGrantCounts.set(tag, 1);
      return saveGas(world);
    }
    expect(bytesFor(['Team.Red', 'State.Stunned', 'Cooldown.A'])).toEqual(
      bytesFor(['Cooldown.A', 'Team.Red', 'State.Stunned'])
    );
  });

  it('keeps effect queue array order and sorts tags and abilities', () => {
    const { world, abilities } = makeWorld();
    const entity = world.createEntity((id) => new Entity(id));
    entity.addComponent(
      abilities.initComponent({
        abilities: ['Ability.Strike', 'Ability.Burn'],
        tags: ['zeta', 'alpha'],
      })
    );
    world.entityManager.addEntity(entity);
    const component = abilityOwnerOf(entity);
    if (component === undefined) throw new Error('missing ability component');
    component.attributes.base[0] = FP.ToRaw(FP.FromInt(40));
    component.attributes.current[0] = FP.ToRaw(FP.FromInt(33));
    component.attributes.dirty[0] = 2;
    component.attributes.dirty[1] = 0;
    component.activeEffects.queue.push(
      {
        instanceId: 9,
        defId: 'Effect.ArmorShred',
        remainingTicks: 3,
        nextPeriodTick: 0,
        sourceEntityId: -1,
        enteredOnTick: 1,
        capturedMagnitudes: null,
      },
      {
        instanceId: 2,
        defId: 'Effect.Burn',
        remainingTicks: 8,
        nextPeriodTick: 6,
        sourceEntityId: 1,
        enteredOnTick: 1,
        capturedMagnitudes: [FP.FromInt(3, 2)],
      }
    );
    component.tags.effectGrantCounts.set('State.Debuff.Burn', 2);
    component.tags.effectGrantCounts.set('State.Buff.Shield', 1);
    abilities.importRuntimeState({
      instanceId: 9,
      currentTick: -1,
      activationRequests: [],
      resolvedActivationsThisTick: [],
    });

    const bytes = saveGas(world);
    const restored = makeWorld();
    const copy = restored.world.createEntity((id) => new Entity(id));
    copy.addComponent(restored.abilities.initComponent({}));
    restored.world.entityManager.addEntity(copy);
    loadGas(bytes, restored.world);
    expect(saveGas(restored.world)).toEqual(bytes);

    const restoredComponent = abilityOwnerOf(copy);
    if (restoredComponent === undefined) {
      throw new Error('missing restored ability component');
    }
    expect(Array.from(restoredComponent.abilities)).toEqual([
      'Ability.Burn',
      'Ability.Strike',
    ]);
    expect(Array.from(restoredComponent.tags.tags)).toEqual(['alpha', 'zeta']);
    expect(Array.from(restoredComponent.tags.adHocTags)).toEqual([
      'alpha',
      'zeta',
    ]);
    expect(
      Array.from(restoredComponent.tags.effectGrantCounts.entries())
    ).toEqual([
      ['State.Buff.Shield', 1],
      ['State.Debuff.Burn', 2],
    ]);
    expect(
      restoredComponent.activeEffects.queue.map(
        (instance) => instance.instanceId
      )
    ).toEqual([9, 2]);
    const captured =
      restoredComponent.activeEffects.queue[1]?.capturedMagnitudes;
    expect(captured?.[0]).toBeDefined();
    if (captured?.[0] === undefined) throw new Error('missing magnitude');
    expect(captured[0].precision).toBe(2n);
    expect(FP.Eq(captured[0], FP.FromInt(3, 2))).toBe(true);
    expect(restoredComponent.attributes.dirty[0]).toBe(2);
    expect(restoredComponent.attributes.dirty[1]).toBe(0);
    expect(restoredComponent.attributes.base[0]).toBe(FP.ToRaw(FP.FromInt(40)));
    expect(restoredComponent.attributes.current[0]).toBe(
      FP.ToRaw(FP.FromInt(33))
    );
  });

  it('round-trips runtime requests, including a non-empty resolved buffer', () => {
    const { world, abilities } = makeWorld();
    abilities.importRuntimeState({
      instanceId: 4,
      currentTick: 7,
      activationRequests: [
        {
          casterEntityId: 1,
          abilityId: 'Ability.Strike',
          enqueueTick: 6,
          providedTarget: { x: FP.FromInt(4, 2) },
        },
      ],
      resolvedActivationsThisTick: [
        {
          abilityId: 'Ability.Strike',
          casterEntityId: 1,
          resolvedTargets: [2, 1],
          tick: 7,
          hookId: 'Hook.Unused',
          providedTarget: { entityId: 2, z: FP.FromInt(1, 2) },
        },
      ],
    });
    const bytes = saveGas(world);
    const restored = makeWorld();
    loadGas(bytes, restored.world);
    expect(saveGas(restored.world)).toEqual(bytes);
    const state = restored.abilities.exportRuntimeState();
    expect(state.instanceId).toBe(4);
    expect(state.currentTick).toBe(7);
    expect(state.activationRequests[0]?.providedTarget?.x?.precision).toBe(2n);
    expect(state.resolvedActivationsThisTick[0]?.resolvedTargets).toEqual([
      2, 1,
    ]);
    expect(state.resolvedActivationsThisTick[0]?.hookId).toBe('Hook.Unused');
    expect(
      state.resolvedActivationsThisTick[0]?.providedTarget?.z?.precision
    ).toBe(2n);
  });

  it('recreates lazy components and rejects missing or extra entities', () => {
    const source = makeWorld();
    const bare = source.world.createEntity((id) => new Entity(id));
    source.world.entityManager.addEntity(bare);
    source.abilities.applyEffect(bare.id, 'Effect.Shield', -1);
    source.world.processAllTicks(0);
    expect(activeEffectsOf(bare)).toBeDefined();
    expect(gameplayTagsOf(bare)?.tags.has('State.Buff.Shield')).toBe(true);

    const bytes = saveGas(source.world);
    const restored = makeWorld();
    const shell = restored.world.createEntity((id) => new Entity(id));
    restored.world.entityManager.addEntity(shell);
    loadGas(bytes, restored.world);
    expect(saveGas(restored.world)).toEqual(bytes);
    expect(activeEffectsOf(shell)?.queue).toHaveLength(1);
    expect(
      gameplayTagsOf(shell)?.effectGrantCounts.get('State.Buff.Shield')
    ).toBe(1);
    expect(shell.hasComponent(ActiveEffects.type)).toBe(true);

    const missing = makeWorld();
    expect(() => loadGas(bytes, missing.world)).toThrow(
      /readAbilities: missing entity 1/
    );

    const extra = makeWorld();
    const first = extra.world.createEntity((id) => new Entity(id));
    extra.world.entityManager.addEntity(first);
    const second = extra.world.createEntity((id) => new Entity(id));
    second.addComponent(extra.abilities.initComponent({}));
    extra.world.entityManager.addEntity(second);
    expect(() => loadGas(bytes, extra.world)).toThrow(
      /readAbilities: extra entity 2/
    );
  });

  it('rejects a component the snapshot does not list', () => {
    const source = makeWorld();
    const tagged = source.world.createEntity((id) => new Entity(id));
    source.world.entityManager.addEntity(tagged);
    source.abilities.addTag(tagged.id, 'Team.Red');
    const bytes = saveGas(source.world);

    const restored = makeWorld();
    const entity = restored.world.createEntity((id) => new Entity(id));
    entity.addComponent(
      restored.abilities.initComponent({ tags: ['Team.Red'] })
    );
    restored.world.entityManager.addEntity(entity);
    expect(() => loadGas(bytes, restored.world)).toThrow(
      /readAbilities: extra AbilityOwner on entity 1/
    );
  });

  it('omits the cue buffer from the bytes', () => {
    function run(pipeline: 'effects' | 'effects-retain-cues'): {
      world: GameWorld;
      abilities: AbilitySystem;
    } {
      const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
      const abilities = createAbilitySystem(world, {
        definitions: defineAbilitySystem({
          attributes: [Health],
          effects: [CueMark],
        }),
        pipeline,
      });
      world.registerSystems([...abilities.tickSystems], []);
      const entity = world.createEntity((id) => new Entity(id));
      entity.addComponent(abilities.initComponent({}));
      world.entityManager.addEntity(entity);
      abilities.applyEffect(entity.id, 'Effect.Cue', entity.id);
      world.processAllTicks(0);
      return { world, abilities };
    }

    const retained = run('effects-retain-cues');
    expect(retained.abilities.gameplayCueBuffer.events.length).toBeGreaterThan(
      0
    );
    const cleared = run('effects');
    expect(cleared.abilities.gameplayCueBuffer.events.length).toBe(0);
    expect(saveGas(cleared.world)).toEqual(saveGas(retained.world));
  });

  it('continues a restored world with the same runtime digest', () => {
    const source = makeWorld();
    const entities = spawnShells(source.world, source.abilities);
    for (let tick = 0; tick < WARMUP_TICKS; tick += 1) {
      drive(source.world, source.abilities, entities, tick);
    }
    source.abilities.activateAbility(at(entities, 0).id, 'Ability.Strike', {
      entityId: at(entities, 1).id,
      x: FP.FromInt(4, 2),
      z: FP.FromInt(1, 2),
    });
    source.abilities.applyEffect(
      at(entities, 12).id,
      'Effect.Strike.Damage',
      at(entities, 0).id,
      new Map<string, unknown>([
        ['bonus', 3],
        ['label', 'pending'],
        ['raw', 9n],
        ['flag', false],
        ['scale', FP.FromInt(2, 3)],
      ])
    );

    const bytes = saveGas(source.world);
    const restored = makeWorld();
    const copies = spawnShells(restored.world, restored.abilities);
    loadGas(bytes, restored.world);
    expect(saveGas(restored.world)).toEqual(bytes);
    expect(restored.abilities.instanceIdCounter).toBe(
      source.abilities.instanceIdCounter
    );

    for (
      let tick = WARMUP_TICKS;
      tick < WARMUP_TICKS + CONTINUATION_TICKS;
      tick += 1
    ) {
      drive(source.world, source.abilities, entities, tick);
      drive(restored.world, restored.abilities, copies, tick);
      expect(saveGas(restored.world)).toEqual(saveGas(source.world));
    }

    expect(attributesOf(at(copies, 12))).toBeDefined();
    expect(activeEffectsOf(at(copies, 13))?.queue.length).toBeGreaterThan(0);
  });

  it('rejects an ability id or effect def id that is not registered', () => {
    const queued = makeWorld();
    const queuedEntity = queued.world.createEntity((id) => new Entity(id));
    queuedEntity.addComponent(queued.abilities.initComponent({}));
    queued.world.entityManager.addEntity(queuedEntity);
    const queuedEffects = abilityOwnerOf(queuedEntity)?.activeEffects;
    if (queuedEffects === undefined) throw new Error('missing effects');
    queuedEffects.queue.push({
      instanceId: 1,
      defId: 'Effect.Missing',
      remainingTicks: 4,
      nextPeriodTick: 0,
      sourceEntityId: -1,
      enteredOnTick: 0,
      capturedMagnitudes: null,
    });
    queued.abilities.importRuntimeState({
      instanceId: 1,
      currentTick: -1,
      activationRequests: [],
      resolvedActivationsThisTick: [],
    });
    const queuedBytes = saveGas(queued.world);
    const queuedRestore = makeWorld();
    const queuedShell = queuedRestore.world.createEntity(
      (id) => new Entity(id)
    );
    queuedShell.addComponent(queuedRestore.abilities.initComponent({}));
    queuedRestore.world.entityManager.addEntity(queuedShell);
    expect(() => loadGas(queuedBytes, queuedRestore.world)).toThrow(
      /readAbilities: effect 'Effect.Missing' is not registered on entity 1/
    );

    const pending = makeWorld();
    const pendingEntity = pending.world.createEntity((id) => new Entity(id));
    pendingEntity.addComponent(pending.abilities.initComponent({}));
    pending.world.entityManager.addEntity(pendingEntity);
    pending.abilities.applyEffect(pendingEntity.id, 'Effect.Burn', -1);
    const pendingEffects = abilityOwnerOf(pendingEntity)?.activeEffects;
    const pendingEntry = pendingEffects?.pendingAdd[0];
    if (pendingEntry === undefined) throw new Error('missing pending add');
    pendingEntry.defId = 'Effect.AlsoMissing';
    const pendingBytes = saveGas(pending.world);
    const pendingRestore = makeWorld();
    const pendingShell = pendingRestore.world.createEntity(
      (id) => new Entity(id)
    );
    pendingShell.addComponent(pendingRestore.abilities.initComponent({}));
    pendingRestore.world.entityManager.addEntity(pendingShell);
    expect(() => loadGas(pendingBytes, pendingRestore.world)).toThrow(
      /readAbilities: effect 'Effect.AlsoMissing' is not registered on entity 1/
    );

    const granted = makeWorld();
    const grantedEntity = granted.world.createEntity((id) => new Entity(id));
    grantedEntity.addComponent(
      granted.abilities.initComponent({ abilities: ['Ability.Strike'] })
    );
    granted.world.entityManager.addEntity(grantedEntity);
    abilityOwnerOf(grantedEntity)?.abilities.add('Ability.Missing');
    const grantedBytes = saveGas(granted.world);
    const grantedRestore = makeWorld();
    const grantedShell = grantedRestore.world.createEntity(
      (id) => new Entity(id)
    );
    grantedShell.addComponent(grantedRestore.abilities.initComponent({}));
    grantedRestore.world.entityManager.addEntity(grantedShell);
    expect(() => loadGas(grantedBytes, grantedRestore.world)).toThrow(
      /readAbilities: ability 'Ability.Missing' is not registered on entity 1/
    );
  });

  it('does not apply the section when a later entity fails validation', () => {
    const source = makeWorld();
    source.abilities.importRuntimeState({
      instanceId: 4,
      currentTick: -1,
      activationRequests: [],
      resolvedActivationsThisTick: [],
    });
    const first = source.world.createEntity((id) => new Entity(id));
    first.addComponent(
      source.abilities.initComponent({
        attributes: { Health: FP.FromInt(11) },
        abilities: ['Ability.Strike'],
      })
    );
    source.world.entityManager.addEntity(first);
    const second = source.world.createEntity((id) => new Entity(id));
    second.addComponent(
      source.abilities.initComponent({ abilities: ['Ability.Burn'] })
    );
    source.world.entityManager.addEntity(second);
    abilityOwnerOf(second)?.abilities.add('Ability.Missing');
    const bytes = saveGas(source.world);

    const restored = makeWorld();
    const shellA = restored.world.createEntity((id) => new Entity(id));
    shellA.addComponent(
      restored.abilities.initComponent({
        attributes: { Health: FP.FromInt(99) },
      })
    );
    restored.world.entityManager.addEntity(shellA);
    const shellB = restored.world.createEntity((id) => new Entity(id));
    shellB.addComponent(restored.abilities.initComponent({}));
    restored.world.entityManager.addEntity(shellB);

    expect(() => loadGas(bytes, restored.world)).toThrow(
      /readAbilities: ability 'Ability.Missing' is not registered on entity 2/
    );
    expect(
      FP.Eq(
        restored.abilities.getAttribute(shellA.id, 'Health').base,
        FP.FromInt(99)
      )
    ).toBe(true);
    expect(restored.abilities.instanceIdCounter).toBe(0);
    expect(abilityOwnerOf(shellB)?.abilities.has('Ability.Missing')).toBe(
      false
    );
    expect(abilityOwnerOf(shellA)?.abilities.has('Ability.Strike')).toBe(false);
  });

  it('rejects an instanceId counter below a queued effect and ignores pending adds', () => {
    const low = makeWorld();
    const entity = low.world.createEntity((id) => new Entity(id));
    entity.addComponent(low.abilities.initComponent({}));
    low.world.entityManager.addEntity(entity);
    const effects = abilityOwnerOf(entity)?.activeEffects;
    if (effects === undefined) throw new Error('missing effects');
    effects.queue.push({
      instanceId: 9,
      defId: 'Effect.Burn',
      remainingTicks: 3,
      nextPeriodTick: 0,
      sourceEntityId: -1,
      enteredOnTick: 0,
      capturedMagnitudes: null,
    });
    effects.pendingAdd.push({
      defId: 'Effect.ArmorShred',
      sourceEntityId: -1,
      setByCaller: null,
    });
    const bytes = saveGas(low.world);
    const restored = makeWorld();
    const shell = restored.world.createEntity((id) => new Entity(id));
    shell.addComponent(restored.abilities.initComponent({}));
    restored.world.entityManager.addEntity(shell);
    expect(() => loadGas(bytes, restored.world)).toThrow(
      /readAbilities: instanceId 0 is below effect instance 9 on entity 1/
    );
    expect(abilityOwnerOf(shell)?.activeEffects.queue).toHaveLength(0);
    expect(restored.abilities.instanceIdCounter).toBe(0);

    const pendingOnly = makeWorld();
    const pendingEntity = pendingOnly.world.createEntity(
      (id) => new Entity(id)
    );
    pendingEntity.addComponent(pendingOnly.abilities.initComponent({}));
    pendingOnly.world.entityManager.addEntity(pendingEntity);
    pendingOnly.abilities.applyEffect(pendingEntity.id, 'Effect.Burn', -1);
    const pendingBytes = saveGas(pendingOnly.world);
    const pendingRestore = makeWorld();
    const pendingShell = pendingRestore.world.createEntity(
      (id) => new Entity(id)
    );
    pendingShell.addComponent(pendingRestore.abilities.initComponent({}));
    pendingRestore.world.entityManager.addEntity(pendingShell);
    loadGas(pendingBytes, pendingRestore.world);
    expect(pendingRestore.abilities.instanceIdCounter).toBe(0);
    expect(abilityOwnerOf(pendingShell)?.activeEffects.pendingAdd).toHaveLength(
      1
    );
  });

  it('applies a large effect list without spreading into splice', () => {
    const source = makeWorld('effects');
    const entity = source.world.createEntity((id) => new Entity(id));
    entity.addComponent(source.abilities.initComponent({}));
    source.world.entityManager.addEntity(entity);
    const effects = activeEffectsOf(entity);
    if (effects === undefined) throw new Error('missing effects');
    const instance = {
      instanceId: 0,
      defId: 'Effect.Burn',
      sourceEntityId: entity.id,
      remainingTicks: 3,
      nextPeriodTick: 1,
      enteredOnTick: 2,
      capturedMagnitudes: null,
    };
    const pending = {
      defId: 'Effect.Burn',
      sourceEntityId: entity.id,
      setByCaller: null,
    };
    for (let index = 0; index < LARGE_EFFECT_COUNT; index += 1) {
      effects.queue.push(instance);
      effects.pendingAdd.push(pending);
    }

    const bytes = saveGas(source.world);
    const restored = makeWorld('effects');
    const shell = restored.world.createEntity((id) => new Entity(id));
    shell.addComponent(restored.abilities.initComponent({}));
    restored.world.entityManager.addEntity(shell);
    const restoredEffects = activeEffectsOf(shell);
    if (restoredEffects === undefined) throw new Error('missing effects');
    const queue = restoredEffects.queue;
    const pendingAdd = restoredEffects.pendingAdd;

    expect(() => {
      loadGas(bytes, restored.world);
    }).not.toThrow();
    expect(restoredEffects.queue).toBe(queue);
    expect(restoredEffects.pendingAdd).toBe(pendingAdd);
    expect(restoredEffects.queue).toHaveLength(LARGE_EFFECT_COUNT);
    expect(restoredEffects.pendingAdd).toHaveLength(LARGE_EFFECT_COUNT);
    const lastEffect = restoredEffects.queue[LARGE_EFFECT_COUNT - 1];
    const lastPending = restoredEffects.pendingAdd[LARGE_EFFECT_COUNT - 1];
    if (lastEffect === undefined || lastPending === undefined) {
      throw new Error('missing restored effect');
    }
    expect(lastEffect.remainingTicks).toBe(3);
    expect(lastEffect.nextPeriodTick).toBe(1);
    expect(lastEffect.enteredOnTick).toBe(2);
    expect(lastEffect.capturedMagnitudes).toBeNull();
    expect(lastPending.defId).toBe('Effect.Burn');
    expect(lastPending.setByCaller).toBeNull();
    expect(restoredEffects.queue[0]?.defId).toBe('Effect.Burn');
  }, 60_000);
});
