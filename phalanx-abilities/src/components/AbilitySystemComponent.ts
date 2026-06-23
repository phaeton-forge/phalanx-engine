import type { Entity, IComponent } from '@phalanx-engine/ecs';
import { AbilitiesComponentType } from './AbilitiesComponentType';
import { ActiveEffectsComponent } from './ActiveEffectsComponent';
import { AttributesComponent } from './AttributesComponent';
import { GameplayTagsComponent } from './GameplayTagsComponent';

/**
 * Aggregate gameplay ability state attached to one entity.
 *
 * Public game code should attach this single component instead of manually
 * adding the package's internal attribute/effect/tag components.
 */
export class AbilitySystemComponent implements IComponent {
  public readonly type = AbilitiesComponentType.AbilitySystem;
  public readonly attributes: AttributesComponent;
  public readonly activeEffects: ActiveEffectsComponent;
  public readonly tags: GameplayTagsComponent;
  public readonly abilities = new Set<string>();

  public constructor(attributeCount: number) {
    this.attributes = new AttributesComponent(attributeCount);
    this.activeEffects = new ActiveEffectsComponent();
    this.tags = new GameplayTagsComponent();
  }
}

export function getAbilitySystemComponent(entity: Entity): AbilitySystemComponent | undefined {
  return entity.getComponent<AbilitySystemComponent>(AbilitiesComponentType.AbilitySystem);
}

export function getAttributesComponent(entity: Entity): AttributesComponent | undefined {
  return (
    getAbilitySystemComponent(entity)?.attributes ??
    entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes)
  );
}

export function getActiveEffectsComponent(entity: Entity): ActiveEffectsComponent | undefined {
  return (
    getAbilitySystemComponent(entity)?.activeEffects ??
    entity.getComponent<ActiveEffectsComponent>(AbilitiesComponentType.ActiveEffects)
  );
}

export function getGameplayTagsComponent(entity: Entity): GameplayTagsComponent | undefined {
  return (
    getAbilitySystemComponent(entity)?.tags ??
    entity.getComponent<GameplayTagsComponent>(AbilitiesComponentType.GameplayTags)
  );
}
