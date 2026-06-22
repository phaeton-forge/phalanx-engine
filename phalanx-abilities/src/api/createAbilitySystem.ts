import type { GameSystem, GameWorld, IAbilitySystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  AbilitiesComponentType,
  AbilitySystemComponent,
} from '../components';
import type { CueConfig } from '../cues';
import {
  AbilityActivationSystem,
  AbilityHookExecutorSystem,
  AttributeAggregationSystem,
  CueBufferCleanupSystem,
  CueDispatchSystem,
  CuePresentationSystem,
  EffectApplicationSystem,
  EffectTickSystem,
} from '../systems';
import { createAbilitySystemRegistries } from '../registry';
import type { AbilitySystemRegistries } from '../registry';
import { createAbilitySystemRuntime } from '../runtime';
import type { AbilitySystemRuntime } from '../runtime';
import type { GameplayCueBufferView } from '../runtime';
import type {
  AbilityHook,
  ProvidedTarget,
} from '../types';
import { AbilitySystemFacade, NO_SOURCE_ENTITY_ID } from './AbilitySystemFacade';
import type { AttributeValue } from './AbilitySystemFacade';
import type { AbilitySystemDefinitions } from './defineAbilitySystem';

export type AbilitySystemPipeline =
  | 'full'
  | 'activation'
  | 'effects'
  /** Like `effects`, but leaves the cue buffer populated for test assertions. */
  | 'effects-retain-cues'
  | 'attributes';

export type AttributeInitializer =
  | FixedPoint
  | {
      base: FixedPoint;
      current?: FixedPoint;
    };

export interface InitialEffect {
  id: string;
  sourceEntityId?: number;
}

export interface AbilitySystemComponentInit {
  attributes?: Record<string, AttributeInitializer>;
  abilities?: readonly string[];
  tags?: readonly string[];
  effects?: readonly (string | InitialEffect)[];
}

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

export interface AbilitySystem extends IAbilitySystem {
  readonly tickSystems: readonly GameSystem[];
  readonly gameplayCueBuffer: GameplayCueBufferView;
  /** High-water mark of allocated active-effect instance ids (for tests). */
  readonly instanceIdCounter: number;
  /** Pending activation requests not yet drained (for tests). */
  readonly pendingActivationCount: number;
  pendingActivationAbilityId(index: number): string | undefined;
  initComponent(init?: AbilitySystemComponentInit): AbilitySystemComponent;
  activateAbility(casterEntityId: number, abilityId: string, providedTarget?: ProvidedTarget): boolean;
  applyEffect(targetEntityId: number, effectId: string, sourceEntityId?: number): void;
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
  const facade = new AbilitySystemFacade(world.entityManager, registries, runtime);

  if (config.hooks) {
    for (const [hookId, hook] of Object.entries(config.hooks)) {
      facade.registerHook(hookId, hook);
    }
  }

  world.entityManager.registerComponentTypes(abilityComponentTypes);

  const cues: CueConfig = config.cues ?? {};

  const abilitySystem = new AbilitySystemImpl(
    registries,
    runtime,
    facade,
    config.pipeline ?? 'full',
    cues
  );

  // Assign on context so every GameSystem can access it via this.abilities.
  // Must be called before world.registerSystems() so that init() can safely
  // read this.abilities during system initialisation.
  world.context.abilities = abilitySystem;

  return abilitySystem;
}

export const abilityComponentTypes: readonly symbol[] = [
  AbilitiesComponentType.AbilitySystem,
  AbilitiesComponentType.Attributes,
  AbilitiesComponentType.ActiveEffects,
  AbilitiesComponentType.GameplayTags,
];

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

  public constructor(
    private readonly registries: AbilitySystemRegistries,
    private readonly runtime: AbilitySystemRuntime,
    private readonly facade: AbilitySystemFacade,
    pipeline: AbilitySystemPipeline,
    cues: CueConfig
  ) {
    this.gameplayCueBuffer = facade.gameplayCueBufferInternal;
    this.tickSystems = buildTickSystems(registries, runtime, pipeline, cues);
  }

  public initComponent(init: AbilitySystemComponentInit = {}): AbilitySystemComponent {
    const component = new AbilitySystemComponent(this.registries.attributes.size);
    this.seedAttributes(component, init.attributes);
    this.seedAbilities(component, init.abilities);
    this.seedTags(component, init.tags);
    this.seedEffects(component, init.effects);
    return component;
  }

  public activateAbility(
    casterEntityId: number,
    abilityId: string,
    providedTarget?: ProvidedTarget
  ): boolean {
    return this.facade.activateAbility(casterEntityId, abilityId, providedTarget);
  }

  public applyEffect(
    targetEntityId: number,
    effectId: string,
    sourceEntityId: number = NO_SOURCE_ENTITY_ID
  ): void {
    this.facade.applyEffect(targetEntityId, effectId, sourceEntityId);
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

  public tryGetAttribute(entityId: number, attrId: string): AttributeValue | undefined {
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

  private seedAttributes(
    component: AbilitySystemComponent,
    overrides: Record<string, AttributeInitializer> | undefined
  ): void {
    const defs = this.registries.attributes.values();
    for (let index = 0; index < defs.length; index++) {
      const rawDefault = FP.ToRaw(defs[index].default);
      component.attributes.base[index] = rawDefault;
      component.attributes.current[index] = rawDefault;
      component.attributes.dirty[index] = 1;
    }
    if (!overrides) {
      return;
    }
    for (const [attributeId, value] of Object.entries(overrides)) {
      const index = this.registries.attributes.indexOf(attributeId);
      const base = isAttributeValuePair(value) ? value.base : value;
      const current = isAttributeValuePair(value) ? value.current ?? value.base : value;
      component.attributes.base[index] = FP.ToRaw(base);
      component.attributes.current[index] = FP.ToRaw(current);
      component.attributes.dirty[index] = 1;
    }
  }

  private seedAbilities(
    component: AbilitySystemComponent,
    abilities: readonly string[] | undefined
  ): void {
    if (!abilities) {
      return;
    }
    for (const abilityId of abilities) {
      if (!this.registries.abilities.has(abilityId)) {
        throw new Error(`AbilityRegistry does not contain '${abilityId}'`);
      }
      component.abilities.add(abilityId);
    }
  }

  private seedTags(
    component: AbilitySystemComponent,
    tags: readonly string[] | undefined
  ): void {
    if (!tags) {
      return;
    }
    for (const tag of tags) {
      component.tags.adHocTags.add(tag);
      component.tags.tags.add(tag);
    }
  }

  private seedEffects(
    component: AbilitySystemComponent,
    effects: readonly (string | InitialEffect)[] | undefined
  ): void {
    if (!effects) {
      return;
    }
    for (const entry of effects) {
      const effectId = typeof entry === 'string' ? entry : entry.id;
      if (!this.registries.effects.has(effectId)) {
        throw new Error(`EffectRegistry does not contain '${effectId}'`);
      }
      component.activeEffects.pendingAdd.push({
        defId: effectId,
        sourceEntityId:
          typeof entry === 'string'
            ? NO_SOURCE_ENTITY_ID
            : entry.sourceEntityId ?? NO_SOURCE_ENTITY_ID,
      });
    }
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

function isAttributeValuePair(
  value: AttributeInitializer
): value is { base: FixedPoint; current?: FixedPoint } {
  // FixedPoint also exposes `.base`; exclude it so plain scalars stay scalars.
  return (
    typeof value === 'object' &&
    value !== null &&
    'base' in value &&
    !('precision' in value)
  );
}

function buildTickSystems(
  registries: AbilitySystemRegistries,
  runtime: AbilitySystemRuntime,
  pipeline: AbilitySystemPipeline,
  cues: CueConfig
): GameSystem[] {
  const effectApplication = new EffectApplicationSystem(registries, runtime);
  const effectTick = new EffectTickSystem(registries, runtime);
  const aggregation = new AttributeAggregationSystem(registries);
  const cueCleanup = new CueBufferCleanupSystem(runtime);
  const hasCues = Object.keys(cues).length > 0;

  if (
    pipeline === 'effects-retain-cues' &&
    !hasCues &&
    process.env.NODE_ENV !== 'production'
  ) {
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
