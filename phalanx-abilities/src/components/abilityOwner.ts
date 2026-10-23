import type {
  Entity,
  IComponent,
  StateReader,
  StateWriter,
} from '@phalanx-engine/ecs';
import {
  defineComponent,
  ValueComponent,
  writeSorted,
} from '@phalanx-engine/ecs';
import {
  ActiveEffects,
  createActiveEffectsState,
  loadActiveEffects,
  saveActiveEffects,
  type ActiveEffectsState,
  type PendingEffectAdd,
} from './activeEffects.js';
import {
  Attributes,
  createAttributesState,
  loadAttributes,
  saveAttributes,
  type AttributesState,
} from './attributes.js';
import {
  createGameplayTagsState,
  GameplayTags,
  loadGameplayTags,
  saveGameplayTags,
  type GameplayTagsState,
} from './gameplayTags.js';

/**
 * Gameplay ability state owned by one entity. Game code attaches it through
 * `AbilitySystem.initComponent` instead of the standalone components.
 */
export interface AbilityOwnerState {
  readonly attributes: AttributesState;
  readonly activeEffects: ActiveEffectsState;
  readonly tags: GameplayTagsState;
  readonly abilities: Set<string>;
}

export function createAbilityOwnerState(
  attributeCount: number
): AbilityOwnerState {
  return {
    attributes: createAttributesState(attributeCount),
    activeEffects: createActiveEffectsState(),
    tags: createGameplayTagsState(),
    abilities: new Set<string>(),
  };
}

/** Abilities sorted by UTF-16 code unit, then attributes, effects and tags. */
export function saveAbilityOwner(
  owner: AbilityOwnerState,
  w: StateWriter
): void {
  writeSorted(w, owner.abilities, (id, item) => item.str(id));
  saveAttributes(owner.attributes, w);
  saveActiveEffects(owner.activeEffects, w);
  saveGameplayTags(owner.tags, w);
}

export function loadAbilityOwner(r: StateReader): AbilityOwnerState {
  const abilities = new Set(r.list((item) => item.str()));
  return {
    abilities,
    attributes: loadAttributes(r),
    activeEffects: loadActiveEffects(r),
    tags: loadGameplayTags(r),
  };
}

/**
 * Attach with `entity.addComponent(abilities.initComponent(init))`, never
 * `world.add`: `world.add` stores a plain value without the pool holder and
 * with zero attributes, which leaves a broken owner.
 */
export const AbilityOwner = defineComponent<AbilityOwnerState>('AbilityOwner', {
  kind: 'object',
  create: () => createAbilityOwnerState(0),
  save: saveAbilityOwner,
  load: loadAbilityOwner,
});

/**
 * @internal Holder for {@link AbilityOwner}. It keeps the factory
 * `pendingAdd` image for pooled respawns next to the saved value.
 */
export class AbilityOwnerSlot extends ValueComponent<AbilityOwnerState> {
  /** Copied in `initComponent`, before a snapshot can replace `pendingAdd`. */
  private initialPending: PendingEffectAdd[] | null = null;
  /** Set when the pool clears `pendingAdd`. The next live `onEnable` reseeds. */
  private reseedPending = false;

  public constructor(value: AbilityOwnerState) {
    super(AbilityOwner.type, value);
  }

  /** The first call wins, so a despawn after restore keeps the factory list. */
  public captureInitialPending(): void {
    if (this.initialPending !== null) return;
    this.initialPending = this.value.activeEffects.pendingAdd.map(copyPending);
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
      this.value.activeEffects.pendingAdd.push(copyPending(entry));
    }
  }
}

function copyPending(entry: PendingEffectAdd): PendingEffectAdd {
  return {
    defId: entry.defId,
    sourceEntityId: entry.sourceEntityId,
    setByCaller: entry.setByCaller ?? null,
  };
}

interface ObjectDef<T extends object> {
  readonly type: symbol;
  create(): T;
}

/** @internal The component as attached, ignoring the owner. */
export function valueOf<T extends object>(
  entity: Entity,
  component: ObjectDef<T>
): T | undefined {
  return entity.getComponent<ValueComponent<T>>(component.type)?.value;
}

/** @internal Attach a standalone value and index it on the entity's manager. */
export function attachValue<T extends object>(
  entity: Entity,
  component: ObjectDef<T>,
  value: T = component.create()
): T {
  entity.addComponent(new ValueComponent(component.type, value));
  entity._manager?.onComponentAdded(entity, component.type);
  return value;
}

/** @internal */
export function abilityOwnerSlotOf(
  entity: Entity
): AbilityOwnerSlot | undefined {
  const held = entity.getComponent<IComponent>(AbilityOwner.type);
  return held instanceof AbilityOwnerSlot ? held : undefined;
}

export function abilityOwnerOf(entity: Entity): AbilityOwnerState | undefined {
  return valueOf(entity, AbilityOwner);
}

/** The owner's attributes, or the standalone {@link Attributes} component. */
export function attributesOf(entity: Entity): AttributesState | undefined {
  return abilityOwnerOf(entity)?.attributes ?? valueOf(entity, Attributes);
}

/** The owner's effects, or the standalone {@link ActiveEffects} component. */
export function activeEffectsOf(
  entity: Entity
): ActiveEffectsState | undefined {
  return (
    abilityOwnerOf(entity)?.activeEffects ?? valueOf(entity, ActiveEffects)
  );
}

/** The owner's tags, or the standalone {@link GameplayTags} component. */
export function gameplayTagsOf(entity: Entity): GameplayTagsState | undefined {
  return abilityOwnerOf(entity)?.tags ?? valueOf(entity, GameplayTags);
}
