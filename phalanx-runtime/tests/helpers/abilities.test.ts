import { afterEach, describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  SoAComponent,
  resetEntityIdCounter,
  type IPoolableEntity,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  AbilitiesComponentType,
  AttributesComponent,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  getAbilitySystemComponent,
  getActiveEffectsComponent,
  getAttributesComponent,
  getGameplayTagsComponent,
  type AbilitySystem,
  type AbilitySystemPipeline,
  type MagnitudeCalculation,
} from '@phalanx-engine/abilities';
import { StateHelpers } from '../../src/helpers/StateHelpers.js';
import {
  BinaryStateReader,
  BinaryStateWriter,
} from '../../src/state/BinaryState.js';
import { digestBytes } from '../../src/state/digest.js';

const ENTITY_COUNT = 20;
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
    StateHelpers.writeAbilities(writer, world);
  });
}

function loadGas(bytes: Uint8Array, world: GameWorld): void {
  const reader = new BinaryStateReader(bytes);
  StateHelpers.readAbilities(reader, world);
  reader.done();
}

function makeWorld(pipeline: AbilitySystemPipeline = 'full'): {
  world: GameWorld;
  abilities: AbilitySystem;
} {
  const world = new GameWorld({});
  const abilities = createAbilitySystem(world, { definitions, pipeline });
  world.registerSystems([...abilities.tickSystems], []);
  return { world, abilities };
}

function standaloneAttributes(): AttributesComponent {
  const attributes = new AttributesComponent(2);
  const defaults = [Health.default, Armor.default];
  for (let index = 0; index < defaults.length; index += 1) {
    const value = defaults[index];
    if (value === undefined) throw new Error('missing attribute default');
    const raw = FP.ToRaw(value);
    attributes.base[index] = raw;
    attributes.current[index] = raw;
    attributes.dirty[index] = 1;
  }
  return attributes;
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
    const entity = new Entity();
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
  afterEach(() => {
    SoAComponent.resetContext();
    resetEntityIdCounter();
  });

  it('throws when the world has no ability system', () => {
    const world = new GameWorld({});
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
    const entity = new Entity();
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
    const other = new Entity();
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
      const entity = new Entity();
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
    const entity = new Entity();
    entity.addComponent(restored.abilities.initComponent({}));
    restored.world.entityManager.addEntity(entity);
    loadGas(bytes, restored.world);
    expect(saveGas(restored.world)).toEqual(bytes);

    const effects = getAbilitySystemComponent(entity)?.activeEffects;
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

  it('keeps effect queue array order and insertion order of tags and abilities', () => {
    const { world, abilities } = makeWorld();
    const entity = new Entity();
    entity.addComponent(
      abilities.initComponent({
        abilities: ['Ability.Burn', 'Ability.Strike'],
        tags: ['zeta', 'alpha'],
      })
    );
    world.entityManager.addEntity(entity);
    const component = getAbilitySystemComponent(entity);
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
    const copy = new Entity();
    copy.addComponent(restored.abilities.initComponent({}));
    restored.world.entityManager.addEntity(copy);
    loadGas(bytes, restored.world);
    expect(saveGas(restored.world)).toEqual(bytes);

    const restoredComponent = getAbilitySystemComponent(copy);
    if (restoredComponent === undefined) {
      throw new Error('missing restored ability component');
    }
    expect(Array.from(restoredComponent.abilities)).toEqual([
      'Ability.Burn',
      'Ability.Strike',
    ]);
    expect(Array.from(restoredComponent.tags.tags)).toEqual(['zeta', 'alpha']);
    expect(Array.from(restoredComponent.tags.adHocTags)).toEqual([
      'zeta',
      'alpha',
    ]);
    expect(
      Array.from(restoredComponent.tags.effectGrantCounts.entries())
    ).toEqual([
      ['State.Debuff.Burn', 2],
      ['State.Buff.Shield', 1],
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
    const bare = new Entity();
    source.world.entityManager.addEntity(bare);
    source.abilities.applyEffect(bare.id, 'Effect.Shield', -1);
    source.world.processAllTicks(0);
    expect(getActiveEffectsComponent(bare)).toBeDefined();
    expect(getGameplayTagsComponent(bare)?.tags.has('State.Buff.Shield')).toBe(
      true
    );

    const bytes = saveGas(source.world);
    const restored = makeWorld();
    const shell = new Entity();
    restored.world.entityManager.addEntity(shell);
    loadGas(bytes, restored.world);
    expect(saveGas(restored.world)).toEqual(bytes);
    expect(getActiveEffectsComponent(shell)?.queue).toHaveLength(1);
    expect(
      getGameplayTagsComponent(shell)?.effectGrantCounts.get(
        'State.Buff.Shield'
      )
    ).toBe(1);
    expect(shell.hasComponent(AbilitiesComponentType.ActiveEffects)).toBe(true);

    const missing = makeWorld();
    expect(() => loadGas(bytes, missing.world)).toThrow(
      /readAbilities: missing entity 1/
    );

    const extra = makeWorld();
    const first = new Entity();
    extra.world.entityManager.addEntity(first);
    const second = new Entity();
    second.addComponent(extra.abilities.initComponent({}));
    extra.world.entityManager.addEntity(second);
    expect(() => loadGas(bytes, extra.world)).toThrow(
      /readAbilities: extra entity 2/
    );
  });

  it('rejects a component the snapshot does not list', () => {
    const source = makeWorld();
    const tagged = new Entity();
    source.world.entityManager.addEntity(tagged);
    source.abilities.addTag(tagged.id, 'Team.Red');
    const bytes = saveGas(source.world);

    const restored = makeWorld();
    const entity = new Entity();
    entity.addComponent(
      restored.abilities.initComponent({ tags: ['Team.Red'] })
    );
    restored.world.entityManager.addEntity(entity);
    expect(() => loadGas(bytes, restored.world)).toThrow(
      /readAbilities: extra AbilitySystem on entity 1/
    );
  });

  it('omits the cue buffer from the bytes', () => {
    function run(pipeline: 'effects' | 'effects-retain-cues'): {
      world: GameWorld;
      abilities: AbilitySystem;
    } {
      const world = new GameWorld({});
      const abilities = createAbilitySystem(world, {
        definitions: defineAbilitySystem({
          attributes: [Health],
          effects: [CueMark],
        }),
        pipeline,
      });
      world.registerSystems([...abilities.tickSystems], []);
      const entity = new Entity();
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
      expect(digestBytes(saveGas(restored.world))).toBe(
        digestBytes(saveGas(source.world))
      );
    }

    expect(getAttributesComponent(at(copies, 12))).toBeDefined();
    expect(
      getActiveEffectsComponent(at(copies, 13))?.queue.length
    ).toBeGreaterThan(0);
  });

  it('rejects an ability id or effect def id that is not registered', () => {
    const queued = makeWorld();
    const queuedEntity = new Entity();
    queuedEntity.addComponent(queued.abilities.initComponent({}));
    queued.world.entityManager.addEntity(queuedEntity);
    const queuedEffects =
      getAbilitySystemComponent(queuedEntity)?.activeEffects;
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
    const queuedShell = new Entity();
    queuedShell.addComponent(queuedRestore.abilities.initComponent({}));
    queuedRestore.world.entityManager.addEntity(queuedShell);
    expect(() => loadGas(queuedBytes, queuedRestore.world)).toThrow(
      /readAbilities: effect 'Effect.Missing' is not registered on entity 1/
    );

    const pending = makeWorld();
    const pendingEntity = new Entity();
    pendingEntity.addComponent(pending.abilities.initComponent({}));
    pending.world.entityManager.addEntity(pendingEntity);
    pending.abilities.applyEffect(pendingEntity.id, 'Effect.Burn', -1);
    const pendingEffects =
      getAbilitySystemComponent(pendingEntity)?.activeEffects;
    const pendingEntry = pendingEffects?.pendingAdd[0];
    if (pendingEntry === undefined) throw new Error('missing pending add');
    pendingEntry.defId = 'Effect.AlsoMissing';
    const pendingBytes = saveGas(pending.world);
    const pendingRestore = makeWorld();
    const pendingShell = new Entity();
    pendingShell.addComponent(pendingRestore.abilities.initComponent({}));
    pendingRestore.world.entityManager.addEntity(pendingShell);
    expect(() => loadGas(pendingBytes, pendingRestore.world)).toThrow(
      /readAbilities: effect 'Effect.AlsoMissing' is not registered on entity 1/
    );

    const granted = makeWorld();
    const grantedEntity = new Entity();
    grantedEntity.addComponent(
      granted.abilities.initComponent({ abilities: ['Ability.Strike'] })
    );
    granted.world.entityManager.addEntity(grantedEntity);
    getAbilitySystemComponent(grantedEntity)?.abilities.add('Ability.Missing');
    const grantedBytes = saveGas(granted.world);
    const grantedRestore = makeWorld();
    const grantedShell = new Entity();
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
    const first = new Entity();
    first.addComponent(
      source.abilities.initComponent({
        attributes: { Health: FP.FromInt(11) },
        abilities: ['Ability.Strike'],
      })
    );
    source.world.entityManager.addEntity(first);
    const second = new Entity();
    second.addComponent(
      source.abilities.initComponent({ abilities: ['Ability.Burn'] })
    );
    source.world.entityManager.addEntity(second);
    getAbilitySystemComponent(second)?.abilities.add('Ability.Missing');
    const bytes = saveGas(source.world);

    const restored = makeWorld();
    const shellA = new Entity();
    shellA.addComponent(
      restored.abilities.initComponent({
        attributes: { Health: FP.FromInt(99) },
      })
    );
    restored.world.entityManager.addEntity(shellA);
    const shellB = new Entity();
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
    expect(
      getAbilitySystemComponent(shellB)?.abilities.has('Ability.Missing')
    ).toBe(false);
    expect(
      getAbilitySystemComponent(shellA)?.abilities.has('Ability.Strike')
    ).toBe(false);
  });

  it('rejects an instanceId counter below a queued effect and ignores pending adds', () => {
    const low = makeWorld();
    const entity = new Entity();
    entity.addComponent(low.abilities.initComponent({}));
    low.world.entityManager.addEntity(entity);
    const effects = getAbilitySystemComponent(entity)?.activeEffects;
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
    const shell = new Entity();
    shell.addComponent(restored.abilities.initComponent({}));
    restored.world.entityManager.addEntity(shell);
    expect(() => loadGas(bytes, restored.world)).toThrow(
      /readAbilities: instanceId 0 is below effect instance 9 on entity 1/
    );
    expect(getAbilitySystemComponent(shell)?.activeEffects.queue).toHaveLength(
      0
    );
    expect(restored.abilities.instanceIdCounter).toBe(0);

    const pendingOnly = makeWorld();
    const pendingEntity = new Entity();
    pendingEntity.addComponent(pendingOnly.abilities.initComponent({}));
    pendingOnly.world.entityManager.addEntity(pendingEntity);
    pendingOnly.abilities.applyEffect(pendingEntity.id, 'Effect.Burn', -1);
    const pendingBytes = saveGas(pendingOnly.world);
    const pendingRestore = makeWorld();
    const pendingShell = new Entity();
    pendingShell.addComponent(pendingRestore.abilities.initComponent({}));
    pendingRestore.world.entityManager.addEntity(pendingShell);
    loadGas(pendingBytes, pendingRestore.world);
    expect(pendingRestore.abilities.instanceIdCounter).toBe(0);
    expect(
      getAbilitySystemComponent(pendingShell)?.activeEffects.pendingAdd
    ).toHaveLength(1);
  });

  it('clears pooled GAS on despawn and continues past respawn', () => {
    const source = pooledGasWorld();
    const pools = source.world.pools;
    if (pools === null) throw new Error('expected pools');
    const live = pools.spawn<PooledMinion>('minion', { health: 90 });
    const freed = pools.spawn<PooledMinion>('minion', { health: 70 });
    expect(
      getAbilitySystemComponent(freed)?.abilities.has('Ability.Burn')
    ).toBe(true);
    expect(getActiveEffectsComponent(freed)?.pendingAdd).toHaveLength(0);

    for (let count = 0; count < 6; count += 1) {
      source.abilities.applyEffect(freed.id, 'Effect.Burn', live.id);
    }
    source.abilities.applyEffect(live.id, 'Effect.ArmorShred', live.id);
    source.world.processAllTicks(0);
    expect(getActiveEffectsComponent(freed)?.queue).toHaveLength(6);
    expect(
      getGameplayTagsComponent(freed)?.effectGrantCounts.get(
        'State.Debuff.Burn'
      )
    ).toBe(6);
    source.abilities.applyEffect(freed.id, 'Effect.ArmorShred', live.id);
    expect(getActiveEffectsComponent(freed)?.pendingAdd).toHaveLength(1);

    pools.despawn(freed);
    expect(getActiveEffectsComponent(freed)?.queue).toHaveLength(0);
    expect(getActiveEffectsComponent(freed)?.pendingAdd).toHaveLength(0);
    expect(getGameplayTagsComponent(freed)?.tags.size).toBe(0);
    expect(getGameplayTagsComponent(freed)?.adHocTags.size).toBe(0);
    expect(getGameplayTagsComponent(freed)?.effectGrantCounts.size).toBe(0);
    expect(
      getAbilitySystemComponent(freed)?.abilities.has('Ability.Burn')
    ).toBe(true);

    const bytes = saveMatch(source.world);
    const restored = pooledGasWorld();
    loadMatch(bytes, restored.world);
    expect(saveMatch(restored.world)).toEqual(bytes);
    expect(restored.world.entityManager.getEntity(freed.id)).toBeUndefined();
    expect(getActiveEffectsComponent(live)?.queue).toHaveLength(1);

    const restoredLive = restored.world.entityManager.getEntity(live.id);
    if (restoredLive === undefined) throw new Error('missing live entity');
    expect(getActiveEffectsComponent(restoredLive)?.queue).toHaveLength(1);

    for (let tick = 1; tick <= 15; tick += 1) {
      if (tick === 1) {
        const again = pools.spawn<PooledMinion>('minion', { health: 80 });
        const restoredPools = restored.world.pools;
        if (restoredPools === null) throw new Error('expected pools');
        const restoredAgain = restoredPools.spawn<PooledMinion>('minion', {
          health: 80,
        });
        expect(again.id).toBe(freed.id);
        expect(restoredAgain.id).toBe(freed.id);
        expect(getActiveEffectsComponent(again)?.queue).toHaveLength(0);
        expect(getActiveEffectsComponent(restoredAgain)?.queue).toHaveLength(0);
        source.abilities.applyEffect(again.id, 'Effect.Burn', live.id);
        restored.abilities.applyEffect(
          restoredAgain.id,
          'Effect.Burn',
          live.id
        );
      }
      source.world.processAllTicks(tick);
      restored.world.processAllTicks(tick);
      expect(digestBytes(saveMatch(restored.world))).toBe(
        digestBytes(saveMatch(source.world))
      );
    }

    const respawned = source.world.entityManager.getEntity(freed.id);
    if (respawned === undefined) throw new Error('missing respawned entity');
    expect(getActiveEffectsComponent(respawned)?.queue).toHaveLength(1);
  });
});

class PooledMinion
  extends Entity
  implements IPoolableEntity<{ health: number }>
{
  public constructor(abilities: AbilitySystem) {
    super();
    this.addComponent(
      abilities.initComponent({
        abilities: ['Ability.Burn', 'Ability.Strike'],
        attributes: {
          Health: FP.FromInt(100),
          Armor: FP.FromInt(10),
        },
        tags: ['Team.Red'],
        effects: ['Effect.Shield'],
      })
    );
  }

  public onSpawn(args: { health: number }): void {
    const component = getAbilitySystemComponent(this);
    if (component === undefined) {
      throw new Error('missing ability component');
    }
    const raw = FP.ToRaw(FP.FromInt(args.health));
    component.attributes.base[0] = raw;
    component.attributes.current[0] = raw;
    component.attributes.dirty[0] = 1;
    component.tags.tags.add('Team.Red');
    component.tags.adHocTags.add('Team.Red');
  }

  public onDespawn(): void {}
}

function pooledGasWorld(): { world: GameWorld; abilities: AbilitySystem } {
  const holder: { abilities?: AbilitySystem } = {};
  const world = new GameWorld({
    pooling: {
      entityTypes: {
        minion: {
          factory: () => {
            const abilities = holder.abilities;
            if (abilities === undefined) {
              throw new Error('ability system is not ready');
            }
            return new PooledMinion(abilities);
          },
        },
      },
    },
  });
  const abilities = createAbilitySystem(world, {
    definitions,
    pipeline: 'full',
  });
  holder.abilities = abilities;
  world.registerSystems([...abilities.tickSystems], []);
  return { world, abilities };
}

function saveMatch(world: GameWorld): Uint8Array {
  return finish((writer) => {
    StateHelpers.writePools(writer, world);
    StateHelpers.writeAbilities(writer, world);
    StateHelpers.writeEntityIds(writer, world);
  });
}

function loadMatch(bytes: Uint8Array, world: GameWorld): void {
  const reader = new BinaryStateReader(bytes);
  StateHelpers.readPools(reader, world);
  StateHelpers.readAbilities(reader, world);
  StateHelpers.readEntityIds(reader, world);
  reader.done();
}
