import type {
  Entity,
  GameWorld,
  SaveSection,
  StateReader,
  StateWriter,
} from '@phalanx-engine/ecs';
import {
  AbilityOwner,
  AbilityOwnerSlot,
  abilityOwnerOf,
  attachValue,
  createAbilityOwnerState,
  loadAbilityOwner,
  saveAbilityOwner,
  valueOf,
  type AbilityOwnerState,
} from '../components/abilityOwner.js';
import {
  ActiveEffects,
  copyActiveEffects,
  loadActiveEffects,
  saveActiveEffects,
  type ActiveEffectsState,
} from '../components/activeEffects.js';
import {
  Attributes,
  copyAttributes,
  loadAttributes,
  saveAttributes,
  type AttributesState,
} from '../components/attributes.js';
import {
  GameplayTags,
  copyGameplayTags,
  loadGameplayTags,
  saveGameplayTags,
  type GameplayTagsState,
} from '../components/gameplayTags.js';
import type {
  AbilityActivationRequest,
  ResolvedAbilityActivationRecord,
} from '../runtime/AbilitySystemRuntime.js';
import type { AbilityRuntimeState } from '../runtime/AbilityRuntimeState.js';
import type { ProvidedTarget } from '../types/TargetSpec.js';
import {
  ABSENT,
  PRESENT,
  readFixedPoint,
  requireFixedPoint,
  writeFixedPoint,
} from './codec.js';

/**
 * Per-world ability runtime plus every entity that has a GAS component.
 *
 * Registered as save section `abilities` version 1. The world writes it
 * inside the `modules` container, after the engine sections and before
 * game singletons.
 *
 * Restore order (normative): roster → pools → SoA stores → entity ids →
 * random → modules (`abilities`, then `physics.broadphase`, by key) →
 * game singletons.
 *
 * Encoded:
 * - `exportRuntimeState()`: instance-id counter, `currentTick`, activation
 *   requests in enqueue order, `resolvedActivationsThisTick` in buffer
 *   order (empty between ticks; still stored so a mid-pipeline snapshot
 *   round-trips).
 * - Each entity with a GAS component, ascending entity id, and which of
 *   `AbilityOwner` / standalone `Attributes` / `ActiveEffects` /
 *   `GameplayTags` it has, each written by that component's `save`.
 *   Missing ones are created on read.
 * - `Attributes`: `base`, `current` (`i64`) and `dirty` (`u8`), index
 *   ascending.
 * - `ActiveEffects`: `queue` and `pendingAdd` in array order.
 * - `GameplayTags`: tags, ad-hoc tags and effect-grant counts, each sorted
 *   by UTF-16 code unit.
 * - `AbilityOwner`: ability ids sorted by UTF-16 code unit, then its
 *   attributes, effects and tags.
 * - `setByCaller` keys sorted by UTF-16 code unit. Values: safe integer,
 *   bigint, string, boolean, or a FixedPoint (raw `base` and `precision`,
 *   both `i64`, the same encoding as broadphase centers). Any other value
 *   throws. Null and undefined payloads share one absent tag and come
 *   back as `null`.
 *
 * Skipped (presentation, scratch, or definitions re-registered by
 * `createWorld`):
 * - `gameplayCueBuffer` and `CuePresentationSystem` cues.
 * - `AbilityActivationSystem` in-flight tag/cost maps (cleared every tick).
 * - `EffectApplicationSystem.attributeIndexCache` and aggregation scratch
 *   buffers.
 * - Registries and hooks (identical definitions on both peers).
 * - There is no `stacks` field and no cooldown component. Cooldowns are
 *   duration effects plus tags.
 *
 * Destroyed entities are omitted, matching ability-system queries.
 * Free-list entities are not registered, so they are omitted too. Returning
 * an entity to the pool clears its effect queue and `pendingAdd`, then
 * copies the factory shell back (`releasePooledAbilityState`): attribute
 * `base` / `current` / `dirty`, the equipped ability set, and ad-hoc tags
 * plus effect grants from construction (`initComponent` tags included).
 * Components attached after that shell are removed. Factory `pendingAdd`
 * is captured in `initComponent`, before a snapshot can replace the list,
 * and `onEnable` copies it back. Effects added after that capture are not
 * part of the image.
 * A respawn whose `onSpawn` does not rewrite attributes still matches a
 * restored copy, because restore builds a fresh factory instance and runs
 * the same hook.
 *
 * `readAbilities` parses and validates the whole section before it mutates
 * the world. An unknown ability id or effect def id throws with the entity
 * id. The instance-id counter must be >= every queued effect instance id.
 * Pending adds have no instance id, so they do not raise that floor.
 */

const HAS_ABILITY_OWNER = 1;
const HAS_ATTRIBUTES = 2;
const HAS_ACTIVE_EFFECTS = 4;
const HAS_GAMEPLAY_TAGS = 8;
const KNOWN_COMPONENT_FLAGS =
  HAS_ABILITY_OWNER | HAS_ATTRIBUTES | HAS_ACTIVE_EFFECTS | HAS_GAMEPLAY_TAGS;

const COMPONENT_BITS: readonly { bit: number; name: string }[] = [
  { bit: HAS_ABILITY_OWNER, name: 'AbilityOwner' },
  { bit: HAS_ATTRIBUTES, name: 'Attributes' },
  { bit: HAS_ACTIVE_EFFECTS, name: 'ActiveEffects' },
  { bit: HAS_GAMEPLAY_TAGS, name: 'GameplayTags' },
];

const PROVIDED_ENTITY = 1;
const PROVIDED_X = 2;
const PROVIDED_Z = 4;
const KNOWN_PROVIDED_FLAGS = PROVIDED_ENTITY | PROVIDED_X | PROVIDED_Z;

interface AbilityStateIO {
  exportRuntimeState(): AbilityRuntimeState;
  importRuntimeState(state: AbilityRuntimeState): void;
  isAbilityRegistered(abilityId: string): boolean;
  isEffectRegistered(effectId: string): boolean;
}

function abilityStateIO(world: GameWorld, helper: string): AbilityStateIO {
  const abilities = world.context.abilities;
  if (abilities === undefined || !hasAbilityStateIO(abilities)) {
    throw new Error(`${helper}: world has no ability system`);
  }
  return abilities;
}

function hasAbilityStateIO(value: object): value is AbilityStateIO {
  const record = value as Record<string, unknown>;
  return (
    typeof record['exportRuntimeState'] === 'function' &&
    typeof record['importRuntimeState'] === 'function' &&
    typeof record['isAbilityRegistered'] === 'function' &&
    typeof record['isEffectRegistered'] === 'function'
  );
}

function componentFlags(entity: Entity): number {
  let flags = 0;
  if (entity.hasComponent(AbilityOwner.type)) flags |= HAS_ABILITY_OWNER;
  if (entity.hasComponent(Attributes.type)) flags |= HAS_ATTRIBUTES;
  if (entity.hasComponent(ActiveEffects.type)) flags |= HAS_ACTIVE_EFFECTS;
  if (entity.hasComponent(GameplayTags.type)) flags |= HAS_GAMEPLAY_TAGS;
  return flags;
}

/**
 * Registered entities that carry a GAS component.
 *
 * Free-list entities are absent from the manager. Shell components had
 * their queue, pending adds, tags, and grants cleared on the way back to
 * the pool, and GAS components attached after the factory shell were
 * removed.
 */
function gasEntities(world: GameWorld): Entity[] {
  const found: Entity[] = [];
  for (const entity of world.entityManager.getAllEntities()) {
    if (entity.isDestroyed) continue;
    if (componentFlags(entity) !== 0) found.push(entity);
  }
  return found;
}

function flagNames(flags: number): string {
  const names: string[] = [];
  for (const entry of COMPONENT_BITS) {
    if ((flags & entry.bit) !== 0) names.push(entry.name);
  }
  return names.join(', ');
}

function writeProvidedTarget(w: StateWriter, target: ProvidedTarget): void {
  let flags = 0;
  if (target.entityId !== undefined) flags |= PROVIDED_ENTITY;
  if (target.x !== undefined) flags |= PROVIDED_X;
  if (target.z !== undefined) flags |= PROVIDED_Z;
  w.u8(flags);
  if (target.entityId !== undefined) w.u32(target.entityId);
  if (target.x !== undefined) {
    writeFixedPoint(w, requireFixedPoint(target.x, 'providedTarget.x'));
  }
  if (target.z !== undefined) {
    writeFixedPoint(w, requireFixedPoint(target.z, 'providedTarget.z'));
  }
}

function readProvidedTarget(r: StateReader): ProvidedTarget {
  const flags = r.u8();
  if ((flags & ~KNOWN_PROVIDED_FLAGS) !== 0) {
    throw new Error(
      `readAbilities: unknown providedTarget flags ${String(flags)}`
    );
  }
  const target: ProvidedTarget = {};
  if ((flags & PROVIDED_ENTITY) !== 0) target.entityId = r.u32();
  if ((flags & PROVIDED_X) !== 0) target.x = readFixedPoint(r);
  if ((flags & PROVIDED_Z) !== 0) target.z = readFixedPoint(r);
  return target;
}

function writeOptionalProvided(
  w: StateWriter,
  target: ProvidedTarget | undefined
): void {
  if (target === undefined) {
    w.u8(ABSENT);
    return;
  }
  w.u8(PRESENT);
  writeProvidedTarget(w, target);
}

function readOptionalProvided(r: StateReader): ProvidedTarget | undefined {
  const tag = r.u8();
  if (tag === ABSENT) return undefined;
  if (tag !== PRESENT) {
    throw new Error(`readAbilities: unknown providedTarget tag ${String(tag)}`);
  }
  return readProvidedTarget(r);
}

function writeRuntime(w: StateWriter, state: AbilityRuntimeState): void {
  w.varint(state.instanceId);
  w.i32(state.currentTick);
  w.list(state.activationRequests, (request, item) => {
    item.u32(request.casterEntityId);
    item.str(request.abilityId);
    item.i32(request.enqueueTick);
    writeOptionalProvided(item, request.providedTarget);
  });
  w.list(state.resolvedActivationsThisTick, (record, item) => {
    item.str(record.abilityId);
    item.u32(record.casterEntityId);
    item.i32(record.tick);
    if (record.hookId === undefined) {
      item.u8(ABSENT);
    } else {
      item.u8(PRESENT);
      item.str(record.hookId);
    }
    writeOptionalProvided(item, record.providedTarget);
    item.list(record.resolvedTargets, (id, idWriter) => {
      idWriter.u32(id);
    });
  });
}

function readRuntime(r: StateReader): AbilityRuntimeState {
  const instanceId = r.varint();
  const currentTick = r.i32();
  const activationRequests = r.list((item): AbilityActivationRequest => {
    const request: AbilityActivationRequest = {
      casterEntityId: item.u32(),
      abilityId: item.str(),
      enqueueTick: item.i32(),
    };
    const providedTarget = readOptionalProvided(item);
    if (providedTarget !== undefined) request.providedTarget = providedTarget;
    return request;
  });
  const resolvedActivationsThisTick = r.list(
    (item): ResolvedAbilityActivationRecord => {
      const record: ResolvedAbilityActivationRecord = {
        abilityId: item.str(),
        casterEntityId: item.u32(),
        tick: item.i32(),
        resolvedTargets: [],
      };
      const hookTag = item.u8();
      if (hookTag === PRESENT) record.hookId = item.str();
      else if (hookTag !== ABSENT) {
        throw new Error(`readAbilities: unknown hook tag ${String(hookTag)}`);
      }
      const providedTarget = readOptionalProvided(item);
      if (providedTarget !== undefined) record.providedTarget = providedTarget;
      record.resolvedTargets = item.list((idReader) => idReader.u32());
      return record;
    }
  );
  return {
    instanceId,
    currentTick,
    activationRequests,
    resolvedActivationsThisTick,
  };
}

function requireValue<T extends object>(
  entity: Entity,
  component: { readonly name: string; readonly type: symbol; create(): T }
): T {
  const value = valueOf(entity, component);
  if (value === undefined) {
    throw new Error(
      `writeAbilities: missing ${component.name} on entity ${String(entity.id)}`
    );
  }
  return value;
}

function writeEntityGas(w: StateWriter, entity: Entity): void {
  const flags = componentFlags(entity);
  w.u32(entity.id);
  w.u8(flags);
  if ((flags & HAS_ABILITY_OWNER) !== 0) {
    saveAbilityOwner(requireValue(entity, AbilityOwner), w);
  }
  if ((flags & HAS_ATTRIBUTES) !== 0) {
    saveAttributes(requireValue(entity, Attributes), w);
  }
  if ((flags & HAS_ACTIVE_EFFECTS) !== 0) {
    saveActiveEffects(requireValue(entity, ActiveEffects), w);
  }
  if ((flags & HAS_GAMEPLAY_TAGS) !== 0) {
    saveGameplayTags(requireValue(entity, GameplayTags), w);
  }
}

interface ParsedEntityGas {
  readonly entityId: number;
  readonly owner?: AbilityOwnerState;
  readonly attributes?: AttributesState;
  readonly effects?: ActiveEffectsState;
  readonly tags?: GameplayTagsState;
}

interface ParsedGas {
  readonly runtime: AbilityRuntimeState;
  readonly entities: ParsedEntityGas[];
}

function assertAttributeCount(
  parsed: AttributesState,
  existing: AttributesState | undefined,
  entityId: number
): void {
  if (existing === undefined) return;
  const count = parsed.base.length;
  if (
    existing.base.length !== count ||
    existing.current.length !== count ||
    existing.dirty.length !== count
  ) {
    throw new Error(
      `readAbilities: attribute count ${String(count)} does not match component length ${String(existing.base.length)} on entity ${String(entityId)}`
    );
  }
}

function assertRegisteredEffects(
  abilities: AbilityStateIO,
  effects: ActiveEffectsState,
  entityId: number
): void {
  for (const instance of effects.queue) {
    assertRegisteredEffect(abilities, instance.defId, entityId);
  }
  for (const pending of effects.pendingAdd) {
    assertRegisteredEffect(abilities, pending.defId, entityId);
  }
}

function assertRegisteredEffect(
  abilities: AbilityStateIO,
  defId: string,
  entityId: number
): void {
  if (!abilities.isEffectRegistered(defId)) {
    throw new Error(
      `readAbilities: effect '${defId}' is not registered on entity ${String(entityId)}`
    );
  }
}

function readOwner(
  r: StateReader,
  entity: Entity,
  abilities: AbilityStateIO
): AbilityOwnerState {
  const owner = loadAbilityOwner(r);
  for (const abilityId of owner.abilities) {
    if (!abilities.isAbilityRegistered(abilityId)) {
      throw new Error(
        `readAbilities: ability '${abilityId}' is not registered on entity ${String(entity.id)}`
      );
    }
  }
  assertAttributeCount(
    owner.attributes,
    abilityOwnerOf(entity)?.attributes,
    entity.id
  );
  assertRegisteredEffects(abilities, owner.activeEffects, entity.id);
  return owner;
}

function readParsedEntity(
  r: StateReader,
  world: GameWorld,
  abilities: AbilityStateIO,
  seen: Set<number>
): ParsedEntityGas {
  const entityId = r.u32();
  if (seen.has(entityId)) {
    throw new Error(`readAbilities: duplicate entity ${String(entityId)}`);
  }
  seen.add(entityId);
  const entity = world.entityManager.getEntity(entityId);
  if (entity === undefined) {
    throw new Error(`readAbilities: missing entity ${String(entityId)}`);
  }
  const flags = r.u8();
  if ((flags & ~KNOWN_COMPONENT_FLAGS) !== 0) {
    throw new Error(
      `readAbilities: unknown component flags ${String(flags)} on entity ${String(entityId)}`
    );
  }
  const extra = componentFlags(entity) & ~flags;
  if (extra !== 0) {
    throw new Error(
      `readAbilities: extra ${flagNames(extra)} on entity ${String(entityId)}`
    );
  }
  // Read order is the byte order: owner, then each standalone component.
  const owner =
    (flags & HAS_ABILITY_OWNER) !== 0
      ? readOwner(r, entity, abilities)
      : undefined;
  let attributes: AttributesState | undefined;
  if ((flags & HAS_ATTRIBUTES) !== 0) {
    attributes = loadAttributes(r);
    assertAttributeCount(attributes, valueOf(entity, Attributes), entityId);
  }
  let effects: ActiveEffectsState | undefined;
  if ((flags & HAS_ACTIVE_EFFECTS) !== 0) {
    effects = loadActiveEffects(r);
    assertRegisteredEffects(abilities, effects, entityId);
  }
  const tags =
    (flags & HAS_GAMEPLAY_TAGS) !== 0 ? loadGameplayTags(r) : undefined;
  return { entityId, owner, attributes, effects, tags };
}

/** Per-world runtime, then GAS entities by id. The `abilities` section body. */
export function writeAbilities(w: StateWriter, world: GameWorld): void {
  const abilities = abilityStateIO(world, 'writeAbilities');
  writeRuntime(w, abilities.exportRuntimeState());
  const entities = gasEntities(world);
  entities.sort((left, right) => {
    if (left.id < right.id) return -1;
    if (left.id > right.id) return 1;
    return 0;
  });
  w.varint(entities.length);
  for (const entity of entities) writeEntityGas(w, entity);
}

/**
 * The counter must cover every effect instance id already in a queue.
 * Pending adds do not carry an instance id; the next drain allocates one.
 */
function assertInstanceIdBound(parsed: ParsedGas): void {
  let max = -1;
  let entityId = -1;
  for (const entity of parsed.entities) {
    const queues = [entity.owner?.activeEffects.queue, entity.effects?.queue];
    for (const queue of queues) {
      if (queue === undefined) continue;
      for (const effect of queue) {
        if (effect.instanceId > max) {
          max = effect.instanceId;
          entityId = entity.entityId;
        }
      }
    }
  }
  if (max >= 0 && parsed.runtime.instanceId < max) {
    throw new Error(
      `readAbilities: instanceId ${String(parsed.runtime.instanceId)} is below effect instance ${String(max)} on entity ${String(entityId)}`
    );
  }
}

function assertNoExtraGasEntities(
  world: GameWorld,
  seen: ReadonlySet<number>
): void {
  for (const entity of gasEntities(world)) {
    if (!seen.has(entity.id)) {
      throw new Error(`readAbilities: extra entity ${String(entity.id)}`);
    }
  }
}

function applyOwner(entity: Entity, parsed: AbilityOwnerState): void {
  let owner = abilityOwnerOf(entity);
  if (owner === undefined) {
    owner = createAbilityOwnerState(parsed.attributes.base.length);
    entity.addComponent(new AbilityOwnerSlot(owner));
    entity._manager?.onComponentAdded(entity, AbilityOwner.type);
  }
  copyAttributes(owner.attributes, parsed.attributes);
  copyActiveEffects(owner.activeEffects, parsed.activeEffects);
  copyGameplayTags(owner.tags, parsed.tags);
  owner.abilities.clear();
  parsed.abilities.forEach((abilityId) => owner.abilities.add(abilityId));
}

function applyEntityGas(world: GameWorld, parsed: ParsedEntityGas): void {
  const entity = world.entityManager.getEntity(parsed.entityId);
  if (entity === undefined) {
    throw new Error(`readAbilities: missing entity ${String(parsed.entityId)}`);
  }
  if (parsed.owner !== undefined) applyOwner(entity, parsed.owner);
  if (parsed.attributes !== undefined) {
    const existing = valueOf(entity, Attributes);
    if (existing === undefined)
      attachValue(entity, Attributes, parsed.attributes);
    else copyAttributes(existing, parsed.attributes);
  }
  if (parsed.effects !== undefined) {
    const existing = valueOf(entity, ActiveEffects);
    if (existing === undefined)
      attachValue(entity, ActiveEffects, parsed.effects);
    else copyActiveEffects(existing, parsed.effects);
  }
  if (parsed.tags !== undefined) {
    const existing = valueOf(entity, GameplayTags);
    if (existing === undefined) attachValue(entity, GameplayTags, parsed.tags);
    else copyGameplayTags(existing, parsed.tags);
  }
}

/**
 * Restores {@link writeAbilities}.
 *
 * The section is parsed and checked before any component or runtime field
 * changes. Entities must already exist (`spawnWithId` / `readPools`).
 * Components the snapshot lists and the entity does not have yet are
 * created. A component the snapshot omits, or an entity the snapshot
 * omits, throws. Ability ids and effect def ids must be in this world's
 * registries. The instance-id counter must be >= every queued instance id.
 */
export function readAbilities(r: StateReader, world: GameWorld): void {
  const abilities = abilityStateIO(world, 'readAbilities');
  const seen = new Set<number>();
  const parsed: ParsedGas = {
    runtime: readRuntime(r),
    entities: r.list((item) => readParsedEntity(item, world, abilities, seen)),
  };
  assertInstanceIdBound(parsed);
  assertNoExtraGasEntities(world, seen);
  abilities.importRuntimeState(parsed.runtime);
  for (const entity of parsed.entities) {
    applyEntityGas(world, entity);
  }
}

/** World save section. Registered by `createAbilitySystem`, not exported. */
export const abilitiesSaveSection: SaveSection = {
  key: 'abilities',
  version: 1,
  write(writer, world) {
    writeAbilities(writer, world);
  },
  read(reader, world) {
    readAbilities(reader, world);
  },
};
