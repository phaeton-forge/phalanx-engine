import type { Entity, IComponent } from '@phalanx-engine/ecs';
import { AbilitiesComponentType } from './AbilitiesComponentType.js';
import {
  ActiveEffectsComponent,
  type PendingEffectAdd,
} from './ActiveEffectsComponent.js';
import { AttributesComponent } from './AttributesComponent.js';
import { GameplayTagsComponent } from './GameplayTagsComponent.js';

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
  /** Copied on the first return to the pool, before `pendingAdd` is cleared. */
  private initialPending: PendingEffectAdd[] | null = null;
  /** Set when the pool clears `pendingAdd`. The next live `onEnable` reseeds. */
  private reseedPending = false;

  public constructor(attributeCount: number) {
    this.attributes = new AttributesComponent(attributeCount);
    this.activeEffects = new ActiveEffectsComponent();
    this.tags = new GameplayTagsComponent();
  }

  /**
   * Remember the factory `pendingAdd` list. Later pool returns clear it;
   * {@link onEnable} copies this image back. A `'restore'` enable does not,
   * because the snapshot already wrote the saved queue.
   */
  public captureInitialPending(): void {
    if (this.initialPending !== null) return;
    this.initialPending = this.activeEffects.pendingAdd.map((entry) => ({
      defId: entry.defId,
      sourceEntityId: entry.sourceEntityId,
      setByCaller: entry.setByCaller ?? null,
    }));
  }

  /** Ask the next non-restore `onEnable` to copy the captured pending list. */
  public requestReseed(): void {
    this.reseedPending = true;
  }

  public onEnable(reason?: 'restore'): void {
    if (reason === 'restore') {
      this.reseedPending = false;
      return;
    }
    if (!this.reseedPending) return;
    this.reseedPending = false;
    const initial = this.initialPending;
    if (initial === null) return;
    for (const entry of initial) {
      this.activeEffects.pendingAdd.push({
        defId: entry.defId,
        sourceEntityId: entry.sourceEntityId,
        setByCaller: entry.setByCaller ?? null,
      });
    }
  }
}

export function getAbilitySystemComponent(
  entity: Entity
): AbilitySystemComponent | undefined {
  return entity.getComponent<AbilitySystemComponent>(
    AbilitiesComponentType.AbilitySystem
  );
}

export function getAttributesComponent(
  entity: Entity
): AttributesComponent | undefined {
  return (
    getAbilitySystemComponent(entity)?.attributes ??
    entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes)
  );
}

export function getActiveEffectsComponent(
  entity: Entity
): ActiveEffectsComponent | undefined {
  return (
    getAbilitySystemComponent(entity)?.activeEffects ??
    entity.getComponent<ActiveEffectsComponent>(
      AbilitiesComponentType.ActiveEffects
    )
  );
}

export function getGameplayTagsComponent(
  entity: Entity
): GameplayTagsComponent | undefined {
  return (
    getAbilitySystemComponent(entity)?.tags ??
    entity.getComponent<GameplayTagsComponent>(
      AbilitiesComponentType.GameplayTags
    )
  );
}
