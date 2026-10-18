import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
};

const ROOT_NAMES: readonly string[] = [
  'AnyGameDefinition',
  'BOT_PLAYER_ID_PREFIX',
  'BinaryStateReader',
  'BinaryStateWriter',
  'BotDecision',
  'BotHost',
  'BotHostSide',
  'BotPolicy',
  'BotPolicyFactory',
  'BotSlotConfig',
  'BotSlotInfo',
  'CommandEnvelope',
  'CommandFieldSpec',
  'CommandFieldType',
  'CommandFromSpec',
  'CommandHandlerMap',
  'CommandLog',
  'CommandOf',
  'CommandRejection',
  'CommandSchemaHash',
  'CommandSpec',
  'CommandsBatch',
  'CompatibilityResult',
  'Component',
  'ComponentLifecycle',
  'ComponentRegistration',
  'ComponentSchemaHash',
  'ConfigOf',
  'DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS',
  'DEFAULT_HASH_EVERY_TICKS',
  'DEFAULT_INPUT_DELAY_TICKS',
  'DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS',
  'DebugComponentSnapshot',
  'DebugDataProvider',
  'DebugDataProviderConfig',
  'DebugEntitySnapshot',
  'DebugPoolSnapshot',
  'DebugSnapshot',
  'DebugSoAStoreSnapshot',
  'DecodedSnapshot',
  'DefineCommandsOptions',
  'DefineComponentOptions',
  'DefinedCommands',
  'DefinedComponent',
  'Digest',
  'DigestFallbackHandler',
  'ENGINE_SNAPSHOT_FORMAT',
  'Entity',
  'EntityManager',
  'EntityPool',
  'EntityTypeConfig',
  'EventBus',
  'ExpectedSnapshotIdentity',
  'FIELD_BYTE_SIZES',
  'FastForwardOptions',
  'FrameHandler',
  'GameCommand',
  'GameComponent',
  'GameContext',
  'GameDefinition',
  'GameSystem',
  'GameWorld',
  'GameWorldConfig',
  'GameWorldEvents',
  'GameWorldHooks',
  'HumanSlotConfig',
  'IAbilitySystem',
  'IAfterFrame',
  'IAfterTick',
  'IBeforeFrame',
  'IBeforeTick',
  'IComponent',
  'IPhysicsWorld',
  'IPoolable',
  'IPoolableEntity',
  'IRandom',
  'ITickFrameProvider',
  'IndexedDbMatchStore',
  'IndexedDbMatchStoreOptions',
  'InputCheckpoint',
  'JsonValue',
  'LoadedMatch',
  'LocalBotSlot',
  'LocalHumanSlot',
  'LocalMatch',
  'LocalSlot',
  'LocalTransport',
  'LocalTransportOptions',
  'LogEntry',
  'MatchConfig',
  'MatchConfigBase',
  'MatchOutcome',
  'MatchOutcomeDraw',
  'MatchOutcomeWin',
  'MatchResumeError',
  'MatchRunner',
  'MatchSnapshotRecord',
  'MatchStore',
  'MemoryMatchStore',
  'NotImplementedError',
  'ObjectPool',
  'OnCommand',
  'PauseHandler',
  'PendingCommandBatch',
  'PersistenceFlushReason',
  'PlayerCommand',
  'PoolConfig',
  'PoolStats',
  'PoolingConfig',
  'REPLAY_FORMAT',
  'ReplayPlayer',
  'ReplayRecord',
  'ResumeLocalOptions',
  'ResumeReport',
  'RunLocalMatchOptions',
  'RunnerOptions',
  'RunnerSide',
  'RunnerStatus',
  'SNAPSHOT_MAGIC',
  'SYSTEM_PLAYER_ID',
  'SimMode',
  'SimOf',
  'SimWorld',
  'SlotConfig',
  'SlotInfo',
  'SlotSequence',
  'SnapshotBytes',
  'SnapshotExtras',
  'SnapshotHeader',
  'SnapshotRejectedError',
  'SnapshotRoundTripError',
  'SoAArrayType',
  'SoAArraysOf',
  'SoAComponent',
  'SoAComponentStoreOptions',
  'SoAFieldType',
  'SoAFieldsOf',
  'SoASchema',
  'SoASchemaDefinition',
  'SoAValueType',
  'SpawnArgsOf',
  'StampedCommand',
  'StampedCommandOf',
  'StartContext',
  'StateReader',
  'StateWriter',
  'SystemContext',
  'SystemRegistry',
  'TickHandler',
  'Transport',
  'TransportCatchUp',
  'TransportJoin',
  'TransportKind',
  'TypedArrayLike',
  'Unsubscribe',
  'VersionDecision',
  'WireCommand',
  'WorldModuleHost',
  'WorldSingletonHooks',
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
];

const MATH_NAMES: readonly string[] = [
  'DeterministicRandom',
  'FP',
  'FPQuaternion',
  'FPQuaternionInterface',
  'FPVector2',
  'FPVector2Interface',
  'FPVector3',
  'FPVector3Interface',
  'FixedPoint',
];

const PHYSICS_NAMES: readonly string[] = [
  'AABB',
  'AutonomousPhysicsTickProvider',
  'AutonomousProviderOptions',
  'BoundsExitEvent',
  'BroadphaseCenter',
  'CollisionEvent',
  'CollisionFilter',
  'CollisionManifold',
  'CollisionSystem',
  'ExternalPhysicsTickProvider',
  'GravitySystem',
  'INTERPOLATION_COMPONENT_TYPE',
  'IPhysicsTickProvider',
  'InterpolatedTransformSample',
  'InterpolationComponent',
  'InterpolationSystem',
  'NarrowPhase',
  'PHYSICS_BODY_COMPONENT_TYPE',
  'PhysicsBodyComponent',
  'PhysicsBodyConfig',
  'PhysicsConfig',
  'PhysicsEvents',
  'PhysicsSoASchema',
  'PhysicsSystem',
  'PhysicsWorld',
  'PhysicsWorldConfig',
  'RayHit',
  'SpatialHashGrid',
  'TRANSFORM_COMPONENT_TYPE',
  'TransformComponent',
  'TransformSoASchema',
  'Vec3FP',
  'segmentVsAABB',
];

const ABILITIES_NAMES: readonly string[] = [
  'ABILITY_ACTIVATED_EVENT',
  'AbilitiesComponentType',
  'AbilityActivatedEvent',
  'AbilityActivationContext',
  'AbilityActivationRequest',
  'AbilityActivationSystem',
  'AbilityDef',
  'AbilityHook',
  'AbilityHookExecutorSystem',
  'AbilityHooksRegistry',
  'AbilityRegistry',
  'AbilityRuntimeState',
  'AbilityStateReader',
  'AbilitySystem',
  'AbilitySystemComponent',
  'AbilitySystemComponentInit',
  'AbilitySystemDefinitions',
  'AbilitySystemFacade',
  'AbilitySystemPipeline',
  'AbilitySystemRegistries',
  'AbilitySystemRuntime',
  'ActiveEffectInstance',
  'ActiveEffectsComponent',
  'AttributeAggregationSystem',
  'AttributeClampMode',
  'AttributeDef',
  'AttributeInitializer',
  'AttributeRegistry',
  'AttributeValue',
  'AttributesComponent',
  'CreateAbilitySystemConfig',
  'Cue',
  'CueBufferCleanupSystem',
  'CueConfig',
  'CueContext',
  'CueDispatchSystem',
  'CueEvent',
  'CueFactory',
  'CuePhase',
  'CuePresentationSystem',
  'EffectApplicationSystem',
  'EffectCueSpec',
  'EffectCues',
  'EffectDef',
  'EffectDefInput',
  'EffectRegistry',
  'EffectTickSystem',
  'EffectType',
  'GAMEPLAY_CUE_EVENT',
  'GameplayCueBuffer',
  'GameplayCueBufferView',
  'GameplayCueDispatchedEvent',
  'GameplayTagsComponent',
  'InitialEffect',
  'InstanceIdCounter',
  'MagnitudeCalcContext',
  'MagnitudeCalculation',
  'Modifier',
  'ModifierOp',
  'NO_SOURCE_ENTITY_ID',
  'PendingEffectAdd',
  'ProvidedTarget',
  'ResolvedAbilityActivationRecord',
  'TargetFilter',
  'TargetOrigin',
  'TargetResolutionInput',
  'TargetResolutionResult',
  'TargetResolver',
  'TargetSpec',
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
];

const ADVANCED_NAMES: readonly string[] = [
  'CommandSchema',
  'DebugPanel',
  'DebugPanelConfig',
  'PoolManager',
  'SaveHandler',
  'SaveSpec',
  'SoAComponentStore',
  'StateHelpers',
  'StateMigration',
  'TYPED_ARRAY_CONSTRUCTORS',
  'TickFrameManager',
  'TickFrameManagerConfig',
  'WorldScope',
  'nextEntityId',
  'rebuildBroadphaseFromTransforms',
  'setEntityIdCounter',
  'setWorldModuleHost',
  'spawnWithId',
];

const ENTRIES = [
  {
    specifier: '@phalanx-engine/game',
    declaration: 'dist/index.d.ts',
    names: ROOT_NAMES,
  },
  {
    specifier: '@phalanx-engine/game/math',
    declaration: 'dist/math.d.ts',
    names: MATH_NAMES,
  },
  {
    specifier: '@phalanx-engine/game/physics',
    declaration: 'dist/physics.d.ts',
    names: PHYSICS_NAMES,
  },
  {
    specifier: '@phalanx-engine/game/abilities',
    declaration: 'dist/abilities.d.ts',
    names: ABILITIES_NAMES,
  },
  {
    specifier: '@phalanx-engine/game/advanced',
    declaration: 'dist/advanced.d.ts',
    names: ADVANCED_NAMES,
  },
] as const;

function declarationFor(specifier: string): string {
  const resolved = ts.resolveModuleName(
    specifier,
    path.join(PACKAGE_ROOT, 'package.json'),
    COMPILER_OPTIONS,
    ts.sys
  ).resolvedModule?.resolvedFileName;
  if (resolved === undefined) {
    throw new Error(`unresolved ${specifier}`);
  }
  return resolved;
}

function namesOf(files: readonly string[]): Map<string, readonly string[]> {
  const program = ts.createProgram([...files], COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const names = new Map<string, readonly string[]>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    const symbol =
      source === undefined ? undefined : checker.getSymbolAtLocation(source);
    if (symbol === undefined) {
      throw new Error(`no module symbol for ${file}`);
    }
    names.set(
      file,
      checker
        .getExportsOfModule(symbol)
        .map((item) => item.getName())
        .sort()
    );
  }
  return names;
}

function overlap(
  sets: ReadonlyArray<readonly [string, readonly string[]]>
): string[] {
  const found: string[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const left = sets[i];
      const right = sets[j];
      if (left === undefined || right === undefined) continue;
      const rightNames = new Set(right[1]);
      for (const name of left[1]) {
        if (rightNames.has(name)) {
          found.push(`${left[0]} ∩ ${right[0]}: ${name}`);
        }
      }
    }
  }
  return found;
}

const resolved = ENTRIES.map((entry) => ({
  specifier: entry.specifier,
  declaration: entry.declaration,
  names: entry.names,
  file: declarationFor(entry.specifier),
}));
const actual = namesOf(resolved.map((entry) => entry.file));

describe('@phalanx-engine/game subpath exports', () => {
  it('resolves each subpath through the exports map', () => {
    for (const entry of resolved) {
      expect(entry.file).toBe(path.join(PACKAGE_ROOT, entry.declaration));
    }
  });

  it('matches the checked-in name snapshot, types included', () => {
    for (const entry of resolved) {
      expect(actual.get(entry.file)).toEqual(entry.names);
    }
    expect(resolved.map((entry) => actual.get(entry.file)?.length)).toEqual([
      186, 9, 33, 85, 18,
    ]);
  });

  it('keeps the five name sets pairwise disjoint', () => {
    expect(
      overlap(
        resolved.map((entry) => {
          const names = actual.get(entry.file);
          if (names === undefined) {
            throw new Error(entry.specifier);
          }
          return [entry.specifier, names] as const;
        })
      )
    ).toEqual([]);
  });

  it('loads each subpath by package name', async () => {
    for (const entry of resolved) {
      const loaded: unknown = await import(entry.specifier);
      const declared = new Set(entry.names);
      expect(
        Object.keys(loaded as object).filter((name) => !declared.has(name))
      ).toEqual([]);
    }
  });
});

describe('package metadata', () => {
  // Task 13 removes `private` and deletes this test.
  it('stays private at 0.3.0 until Task 13', () => {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('private' in parsed) ||
      !('version' in parsed) ||
      typeof parsed.private !== 'boolean' ||
      typeof parsed.version !== 'string'
    ) {
      throw new Error('package.json is missing private or version');
    }
    expect(parsed.private).toBe(true);
    expect(parsed.version).toBe('0.3.0');
  });
});
