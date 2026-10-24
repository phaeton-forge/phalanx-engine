import type { GameSystem, GameWorld } from '@phalanx-engine/ecs';
import type { CueConfig } from '../cues/index.js';
import {
  AbilityActivationSystem,
  AbilityHookExecutorSystem,
  AttributeAggregationSystem,
  CueBufferCleanupSystem,
  CueDispatchSystem,
  CuePresentationSystem,
  EffectApplicationSystem,
  EffectTickSystem,
} from '../systems/index.js';
import { abilitiesSaveSection } from '../save/abilities.js';
import { createAbilitySystemRegistries } from '../registry/index.js';
import type { AbilitySystemRegistries } from '../registry/index.js';
import { createAbilitySystemRuntime } from '../runtime/index.js';
import type {
  AbilityRuntimeState,
  AbilitySystemRuntime,
  GameplayCueBufferView,
} from '../runtime/index.js';
import {
  exportAbilityRuntimeState,
  importAbilityRuntimeState,
} from '../runtime/AbilityRuntimeState.js';
import type { AbilityHook, ProvidedTarget } from '../types/index.js';
import {
  AbilitySystemFacade,
  NO_SOURCE_ENTITY_ID,
} from './AbilitySystemFacade.js';
import { registerAbilityComponents } from './abilityComponents.js';
import { releasePooledAbilityState } from './releasePooledAbilityState.js';
import { Abilities } from './service.js';
import type { AttributeValue } from './AbilitySystemFacade.js';
import type { AbilitySystemDefinitions } from './defineAbilitySystem.js';

export type AbilitySystemPipeline =
  | 'full'
  | 'activation'
  | 'effects'
  /** Like `effects`, but leaves the cue buffer populated for test assertions. */
  | 'effects-retain-cues'
  | 'attributes';

export type {
  AbilityOwnerInit,
  AttributeInitializer,
  InitialEffect,
} from '../components/init.js';

export interface CreateAbilitySystemConfig {
  definitions: AbilitySystemDefinitions;
  hooks?: Record<string, AbilityHook>;
  /**
   * Which simulation systems to register. Defaults to `full`.
   */
  pipeline?: AbilitySystemPipeline;
  /**
   * Client-side cue presentation factories, keyed by cue id. When non-empty, the
   * engine registers {@link CueDispatchSystem} and {@link CuePresentationSystem}
   * automatically. Each dispatch invokes the matching factory to create a fresh,
   * self-managing {@link Cue} instance.
   */
  cues?: CueConfig;
}

export interface AbilitySystem {
  /**
   * Ability systems in pipeline order. `createAbilitySystem` adds them as
   * module systems; list the whole group in `registerSystems` only to place
   * it among the game's systems.
   */
  readonly tickSystems: readonly GameSystem[];
  readonly gameplayCueBuffer: GameplayCueBufferView;
  /** High-water mark of allocated active-effect instance ids (for tests). */
  readonly instanceIdCounter: number;
  /** Pending activation requests not yet drained (for tests). */
  readonly pendingActivationCount: number;
  pendingActivationAbilityId(index: number): string | undefined;
  /**
   * Copy the per-world runtime (instance-id counter, activation queue,
   * current tick, resolved activations). The cue buffer is presentation
   * and is not included.
   */
  exportRuntimeState(): AbilityRuntimeState;
  /**
   * Replace the per-world runtime from {@link exportRuntimeState}.
   * Does not touch the cue buffer. Throws if `state` is not a valid
   * snapshot of that runtime, or if an `abilityId` is not in this world's
   * ability registry.
   *
   * `state.instanceId` must be >= every live effect instance id. A lower
   * integer is stored; keeping it above the live ids is the caller's
   * responsibility. `readAbilities` enforces that bound before it applies.
   */
  importRuntimeState(state: AbilityRuntimeState): void;
  /** True when `abilityId` is in this world's ability registry. */
  isAbilityRegistered(abilityId: string): boolean;
  /** True when `effectId` is in this world's effect registry. */
  isEffectRegistered(effectId: string): boolean;
  activateAbility(
    casterEntityId: number,
    abilityId: string,
    providedTarget?: ProvidedTarget
  ): boolean;
  applyEffect(
    targetEntityId: number,
    effectId: string,
    sourceEntityId?: number,
    setByCaller?: ReadonlyMap<string, unknown>
  ): void;
  removeEffectsByTag(entityId: number, grantedTag: string): number;
  removeEffectsByDefId(entityId: number, effectId: string): number;
  getAttribute(entityId: number, attrId: string): AttributeValue;
  tryGetAttribute(entityId: number, attrId: string): AttributeValue | undefined;
  hasTag(entityId: number, tag: string): boolean;
  addTag(entityId: number, tag: string): void;
  removeTag(entityId: number, tag: string): boolean;
}

export function createAbilitySystem(
  world: GameWorld,
  config: CreateAbilitySystemConfig
): AbilitySystem {
  const registries = createAbilitySystemRegistries();
  registerDefinitions(registries, config.definitions);

  const runtime = createAbilitySystemRuntime();
  const facade = new AbilitySystemFacade(
    world.entityManager,
    registries,
    runtime
  );

  if (config.hooks) {
    for (const [hookId, hook] of Object.entries(config.hooks)) {
      facade.registerHook(hookId, hook);
    }
  }

  const cues: CueConfig = config.cues ?? {};

  const abilitySystem = new AbilitySystemImpl(
    registries,
    runtime,
    facade,
    config.pipeline ?? 'full',
    cues
  );

  // The `abilities` section saves these; the pool hook below resets them.
  registerAbilityComponents(world, registries);
  // Before world.registerSystems(), so system init() can read the service.
  world.provide(Abilities, abilitySystem);
  world.addModuleSystems(abilitySystem.tickSystems, []);
  world.registerSaveSection(abilitiesSaveSection);

  // Free-list entities are omitted from the GAS snapshot. Clearing here
  // makes a respawn after restore match a respawn that never snapshotted.
  if (world.pools !== null) {
    world.pools.addReturnToPoolHook(releasePooledAbilityState);
  }

  return abilitySystem;
}

class AbilitySystemImpl implements AbilitySystem {
  public readonly tickSystems: readonly GameSystem[];

  public readonly gameplayCueBuffer: GameplayCueBufferView;

  public get instanceIdCounter(): number {
    return this.runtime.instanceIdCounter.current;
  }

  public get pendingActivationCount(): number {
    return this.runtime.activationRequests.length;
  }

  public pendingActivationAbilityId(index: number): string | undefined {
    return this.runtime.activationRequests[index]?.abilityId;
  }

  public exportRuntimeState(): AbilityRuntimeState {
    return exportAbilityRuntimeState(this.runtime);
  }

  public importRuntimeState(state: AbilityRuntimeState): void {
    importAbilityRuntimeState(this.runtime, state, this.registries.abilities);
  }

  public isAbilityRegistered(abilityId: string): boolean {
    return this.registries.abilities.has(abilityId);
  }

  public isEffectRegistered(effectId: string): boolean {
    return this.registries.effects.has(effectId);
  }

  public constructor(
    private readonly registries: AbilitySystemRegistries,
    private readonly runtime: AbilitySystemRuntime,
    private readonly facade: AbilitySystemFacade,
    pipeline: AbilitySystemPipeline,
    cues: CueConfig
  ) {
    this.gameplayCueBuffer = facade.gameplayCueBufferInternal;
    this.tickSystems = buildTickSystems(
      registries,
      runtime,
      facade,
      pipeline,
      cues
    );
  }

  public activateAbility(
    casterEntityId: number,
    abilityId: string,
    providedTarget?: ProvidedTarget
  ): boolean {
    return this.facade.activateAbility(
      casterEntityId,
      abilityId,
      providedTarget
    );
  }

  public applyEffect(
    targetEntityId: number,
    effectId: string,
    sourceEntityId: number = NO_SOURCE_ENTITY_ID,
    setByCaller?: ReadonlyMap<string, unknown>
  ): void {
    this.facade.applyEffect(
      targetEntityId,
      effectId,
      sourceEntityId,
      setByCaller
    );
  }

  public removeEffectsByTag(entityId: number, grantedTag: string): number {
    return this.facade.removeEffectsByTag(entityId, grantedTag);
  }

  public removeEffectsByDefId(entityId: number, effectId: string): number {
    return this.facade.removeEffectsByDefId(entityId, effectId);
  }

  public getAttribute(entityId: number, attrId: string): AttributeValue {
    return this.facade.getAttribute(entityId, attrId);
  }

  public tryGetAttribute(
    entityId: number,
    attrId: string
  ): AttributeValue | undefined {
    return this.facade.tryGetAttribute(entityId, attrId);
  }

  public hasTag(entityId: number, tag: string): boolean {
    return this.facade.hasTag(entityId, tag);
  }

  public addTag(entityId: number, tag: string): void {
    this.facade.addTag(entityId, tag);
  }

  public removeTag(entityId: number, tag: string): boolean {
    return this.facade.removeTag(entityId, tag);
  }
}

function registerDefinitions(
  registries: AbilitySystemRegistries,
  definitions: AbilitySystemDefinitions
): void {
  for (const attribute of definitions.attributes) {
    registries.attributes.register(attribute);
  }
  for (const effect of definitions.effects ?? []) {
    registries.effects.register(effect);
  }
  for (const ability of definitions.abilities ?? []) {
    registries.abilities.register(ability);
  }
}

function buildTickSystems(
  registries: AbilitySystemRegistries,
  runtime: AbilitySystemRuntime,
  facade: AbilitySystemFacade,
  pipeline: AbilitySystemPipeline,
  cues: CueConfig
): GameSystem[] {
  const effectApplication = new EffectApplicationSystem(
    registries,
    runtime,
    facade
  );
  const effectTick = new EffectTickSystem(registries, runtime);
  const aggregation = new AttributeAggregationSystem(registries);
  const cueCleanup = new CueBufferCleanupSystem(runtime);
  const hasCues = Object.keys(cues).length > 0;

  if (pipeline === 'effects-retain-cues' && !hasCues) {
    console.warn(
      '[phalanx-abilities] pipeline "effects-retain-cues" with no cues registered: ' +
        'the cue buffer is retained for manual inspection but nothing dispatches it.'
    );
  }

  const systems: GameSystem[] = (() => {
    switch (pipeline) {
      case 'attributes':
        return [aggregation];

      case 'effects':
      case 'effects-retain-cues': {
        const base: GameSystem[] = [effectApplication, effectTick, aggregation];
        if (hasCues) {
          base.push(new CueDispatchSystem(runtime));
        }
        if (pipeline === 'effects') {
          base.push(cueCleanup);
        }
        return base;
      }

      case 'activation':
      case 'full':
        return [
          new AbilityActivationSystem(registries, runtime),
          effectApplication,
          new AbilityHookExecutorSystem(registries, runtime),
          effectTick,
          aggregation,
          ...(hasCues ? [new CueDispatchSystem(runtime)] : []),
          cueCleanup,
        ];
    }
  })();

  if (hasCues) {
    systems.push(new CuePresentationSystem(cues));
  }

  return systems;
}
