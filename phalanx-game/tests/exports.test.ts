import { describe, expect, it } from 'vitest';

const ROOT_VALUES = [
  'BOT_PLAYER_ID_PREFIX',
  'BinaryStateReader',
  'BinaryStateWriter',
  'BotHost',
  'CommandLog',
  'DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS',
  'DEFAULT_HASH_EVERY_TICKS',
  'DEFAULT_INPUT_DELAY_TICKS',
  'DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS',
  'DebugDataProvider',
  'ENGINE_SNAPSHOT_FORMAT',
  'Entity',
  'EntityManager',
  'EntityPool',
  'EventBus',
  'FIELD_BYTE_SIZES',
  'GameSystem',
  'GameWorld',
  'GameWorldEvents',
  'IndexedDbMatchStore',
  'LocalTransport',
  'MatchResumeError',
  'MatchRunner',
  'MemoryMatchStore',
  'NotImplementedError',
  'ObjectPool',
  'REPLAY_FORMAT',
  'ReplayPlayer',
  'SNAPSHOT_MAGIC',
  'SYSTEM_PLAYER_ID',
  'SnapshotRejectedError',
  'SnapshotRoundTripError',
  'SoAComponent',
  'SystemContext',
  'SystemRegistry',
  'bindWorldSingletons',
  'botPlayerId',
  'botSlotSeed',
  'calculateSchemaByteSize',
  'canonicalConfigBytes',
  'checkSnapshotCompatibility',
  'configHash',
  'createComponentTypeRegistry',
  'decodeSnapshot',
  'defineCommands',
  'defineComponent',
  'defineGame',
  'defineSoASchema',
  'digestBytes',
  'encodeSnapshot',
  'getEntityIdCounter',
  'globalEventBus',
  'initDigest',
  'isAfterFrame',
  'isAfterTick',
  'isBeforeFrame',
  'isBeforeTick',
  'isBotPlayerId',
  'isCommandRejection',
  'onDigestFallback',
  'rejectCommand',
  'runLocalMatch',
] as const;

const MATH_VALUES = [
  'DeterministicRandom',
  'FP',
  'FPQuaternion',
  'FPVector2',
  'FPVector3',
  'FixedPoint',
] as const;

const PHYSICS_VALUES = [
  'AutonomousPhysicsTickProvider',
  'CollisionSystem',
  'ExternalPhysicsTickProvider',
  'GravitySystem',
  'INTERPOLATION_COMPONENT_TYPE',
  'InterpolationComponent',
  'InterpolationSystem',
  'NarrowPhase',
  'PHYSICS_BODY_COMPONENT_TYPE',
  'PhysicsBodyComponent',
  'PhysicsEvents',
  'PhysicsSoASchema',
  'PhysicsSystem',
  'PhysicsWorld',
  'SpatialHashGrid',
  'TRANSFORM_COMPONENT_TYPE',
  'TransformComponent',
  'TransformSoASchema',
  'segmentVsAABB',
] as const;

const ABILITIES_VALUES = [
  'ABILITY_ACTIVATED_EVENT',
  'AbilitiesComponentType',
  'AbilityActivationSystem',
  'AbilityHookExecutorSystem',
  'AbilityHooksRegistry',
  'AbilityRegistry',
  'AbilitySystemComponent',
  'AbilitySystemFacade',
  'ActiveEffectsComponent',
  'AttributeAggregationSystem',
  'AttributeRegistry',
  'AttributesComponent',
  'Cue',
  'CueBufferCleanupSystem',
  'CueDispatchSystem',
  'CuePresentationSystem',
  'EffectApplicationSystem',
  'EffectRegistry',
  'EffectTickSystem',
  'GAMEPLAY_CUE_EVENT',
  'GameplayTagsComponent',
  'InstanceIdCounter',
  'NO_SOURCE_ENTITY_ID',
  'TargetResolver',
  'abilityComponentTypes',
  'appendGameplayCueEvents',
  'createAbilitySystem',
  'createAbilitySystemRegistries',
  'createAbilitySystemRuntime',
  'createGameplayCueBuffer',
  'defineAbility',
  'defineAbilitySystem',
  'defineAttribute',
  'defineEffect',
  'gameplayCueKey',
  'getAbilitySystemComponent',
  'getActiveEffectsComponent',
  'getAttributesComponent',
  'getCueIdsForPhase',
  'getGameplayTagsComponent',
] as const;

const ADVANCED_VALUES = [
  'DebugPanel',
  'PoolManager',
  'SoAComponentStore',
  'StateHelpers',
  'TYPED_ARRAY_CONSTRUCTORS',
  'TickFrameManager',
  'WorldScope',
  'nextEntityId',
  'rebuildBroadphaseFromTransforms',
  'setEntityIdCounter',
  'setWorldModuleHost',
  'spawnWithId',
] as const;

const MATH_NAMES = [
  'DeterministicRandom',
  'FP',
  'FPQuaternion',
  'FPQuaternionInterface',
  'FPVector2',
  'FPVector2Interface',
  'FPVector3',
  'FPVector3Interface',
  'FixedPoint',
] as const;

const MATH_TYPE_ONLY = [
  'FPQuaternionInterface',
  'FPVector2Interface',
  'FPVector3Interface',
] as const;

const VALUE_SNAPSHOTS = {
  '.': ROOT_VALUES,
  '/math': MATH_VALUES,
  '/physics': PHYSICS_VALUES,
  '/abilities': ABILITIES_VALUES,
  '/advanced': ADVANCED_VALUES,
} as const;

async function valueKeys(entry: string): Promise<string[]> {
  const loaded: unknown = await import(entry);
  return Object.keys(loaded as object).sort();
}

function overlap(left: readonly string[], right: readonly string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((name) => rightSet.has(name));
}

describe('@phalanx-engine/game subpath exports', () => {
  it('matches the checked-in value snapshot for each dist entry', async () => {
    expect(await valueKeys('../dist/index.js')).toEqual([...ROOT_VALUES]);
    expect(await valueKeys('../dist/math.js')).toEqual([...MATH_VALUES]);
    expect(await valueKeys('../dist/physics.js')).toEqual([...PHYSICS_VALUES]);
    expect(await valueKeys('../dist/abilities.js')).toEqual([
      ...ABILITIES_VALUES,
    ]);
    expect(await valueKeys('../dist/advanced.js')).toEqual([
      ...ADVANCED_VALUES,
    ]);
  });

  it('keeps the five value sets pairwise disjoint', () => {
    const names = Object.keys(
      VALUE_SNAPSHOTS
    ) as (keyof typeof VALUE_SNAPSHOTS)[];
    const collisions: string[] = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const left = names[i];
        const right = names[j];
        if (left === undefined || right === undefined) continue;
        for (const name of overlap(
          VALUE_SNAPSHOTS[left],
          VALUE_SNAPSHOTS[right]
        )) {
          collisions.push(`${left} ∩ ${right}: ${name}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('keeps math off the root and equal to the nine math names', async () => {
    const root = await valueKeys('../dist/index.js');
    const math = await valueKeys('../dist/math.js');
    for (const name of MATH_NAMES) {
      expect(root).not.toContain(name);
    }
    const typeOnly = new Set<string>(MATH_TYPE_ONLY);
    expect(math).toEqual(MATH_NAMES.filter((name) => !typeOnly.has(name)));
    expect([...math, ...MATH_TYPE_ONLY].sort()).toEqual([...MATH_NAMES].sort());
  });

  it('matches @phalanx-engine/runtime/advanced value keys', async () => {
    expect(await valueKeys('@phalanx-engine/runtime/advanced')).toEqual([
      ...ADVANCED_VALUES,
    ]);
  });
});
