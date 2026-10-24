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
  type ActiveEffectsState,
  type PendingEffectAdd,
} from './activeEffects.js';
import { Attributes, type AttributesState } from './attributes.js';
import { GameplayTags, type GameplayTagsState } from './gameplayTags.js';

/**
 * The ability set granted to one entity. Its attributes, effects and tags
 * are the separate {@link Attributes}, {@link ActiveEffects} and
 * {@link GameplayTags} components; `AbilitySystem.initComponent` attaches
 * all four.
 */
export interface AbilityOwnerState {
  readonly abilities: Set<string>;
}

export function createAbilityOwnerState(): AbilityOwnerState {
  return { abilities: new Set<string>() };
}

/** Ability ids sorted by UTF-16 code unit. */
export function saveAbilityOwner(
  owner: AbilityOwnerState,
  w: StateWriter
): void {
  writeSorted(w, owner.abilities, (id, item) => item.str(id));
}

export function loadAbilityOwner(r: StateReader): AbilityOwnerState {
  return { abilities: new Set(r.list((item) => item.str())) };
}

/**
 * Attach with `entity.addComponents(abilities.initComponent(init))`.
 * `world.addComponent` throws once `createAbilitySystem` has registered it.
 */
export const AbilityOwner = defineComponent<AbilityOwnerState>('AbilityOwner', {
  kind: 'object',
  create: createAbilityOwnerState,
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
  private reseedTarget: ActiveEffectsState | null = null;

  public constructor(value: AbilityOwnerState) {
    super(AbilityOwner.type, value);
  }

  /** The first call wins, so a despawn after restore keeps the factory list. */
  public captureInitialPending(effects: ActiveEffectsState): void {
    if (this.initialPending !== null) return;
    this.initialPending = effects.pendingAdd.map(copyPending);
  }

  /** Ask the next non-restore `onEnable` to copy the captured list into `effects`. */
  public requestReseed(effects: ActiveEffectsState): void {
    this.reseedTarget = effects;
  }

  public onEnable(reason?: 'restore'): void {
    const target = this.reseedTarget;
    this.reseedTarget = null;
    if (reason === 'restore' || target === null) return;
    const initial = this.initialPending;
    if (initial === null) return;
    for (const entry of initial) {
      target.pendingAdd.push(copyPending(entry));
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

export function attributesOf(entity: Entity): AttributesState | undefined {
  return valueOf(entity, Attributes);
}

export function activeEffectsOf(
  entity: Entity
): ActiveEffectsState | undefined {
  return valueOf(entity, ActiveEffects);
}

export function gameplayTagsOf(entity: Entity): GameplayTagsState | undefined {
  return valueOf(entity, GameplayTags);
}
