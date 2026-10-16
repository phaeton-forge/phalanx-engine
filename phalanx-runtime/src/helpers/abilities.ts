import type { Entity, GameWorld } from '@phalanx-engine/ecs';
import {
  AbilitiesComponentType,
  AbilitySystemComponent,
  ActiveEffectsComponent,
  AttributesComponent,
  GameplayTagsComponent,
} from '@phalanx-engine/abilities';
import type {
  AbilityActivationRequest,
  AbilityRuntimeState,
  ActiveEffectInstance,
  PendingEffectAdd,
  ProvidedTarget,
  ResolvedAbilityActivationRecord,
} from '@phalanx-engine/abilities';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import type { StateReader, StateWriter } from '../state/StateIO.js';
import {
  assertSectionVersion,
  HELPER_SECTION_VERSION,
} from './sectionVersion.js';

/**
 * Per-world ability runtime plus every entity that has a GAS component.
 *
 * `section('gas', 1)`. The design sketch wraps this call in the same
 * section; the helper opens it, the same way `writePools` opens `pools`.
 *
 * Restore order (normative): `spawnWithId` (non-pooled) → `readPools` →
 * `readSoAStores` → `readAbilities` → `readEntityIds` → `readRandom` →
 * `readBroadphase`.
 *
 * Encoded:
 * - `exportRuntimeState()`: instance-id counter, `currentTick`, activation
 *   requests in enqueue order, `resolvedActivationsThisTick` in buffer
 *   order (empty between ticks; still stored so a mid-pipeline snapshot
 *   round-trips).
 * - Each entity with a GAS component, ascending entity id, and which of
 *   `AbilitySystem` / standalone `Attributes` / `ActiveEffects` /
 *   `GameplayTags` it has. Missing ones are created on read.
 * - `AttributesComponent` `base`, `current` (`i64`) and `dirty` (`u8`),
 *   index ascending.
 * - `ActiveEffectsComponent.queue` and `pendingAdd` in array order.
 * - `GameplayTagsComponent` tags, ad-hoc tags and effect-grant counts in
 *   Set/Map insertion order (not sorted). `Set` and `Map` preserve
 *   insertion, and effect application inserts tags in simulation order.
 *   The task notes keep that order instead of sorting by tag string.
 * - `AbilitySystemComponent.abilities` in Set insertion order.
 * - `setByCaller` keys sorted by UTF-16 code unit. Values: safe integer,
 *   bigint, string, boolean, or a FixedPoint (`base` + precision). Any
 *   other value throws. Null and undefined payloads share one absent tag
 *   and come back as `null`.
 *
 * Skipped (presentation, scratch, or definitions re-registered by
 * `createWorld`):
 * - `gameplayCueBuffer` and `CuePresentationSystem` cues.
 * - `AbilityActivationSystem` in-flight tag/cost maps (cleared every tick).
 * - `EffectApplicationSystem.attributeIndexCache` and aggregation scratch
 *   buffers.
 * - Registries and hooks (identical definitions on both peers).
 * - Component `type` symbols (the class constructor sets them).
 * - There is no `stacks` field and no cooldown component. Cooldowns are
 *   duration effects plus tags.
 *
 * Destroyed entities are omitted, matching ability-system queries.
 */

const GAS_SECTION = 'gas';

const HAS_ABILITY_SYSTEM = 1;
const HAS_ATTRIBUTES = 2;
const HAS_ACTIVE_EFFECTS = 4;
const HAS_GAMEPLAY_TAGS = 8;
const KNOWN_COMPONENT_FLAGS =
  HAS_ABILITY_SYSTEM | HAS_ATTRIBUTES | HAS_ACTIVE_EFFECTS | HAS_GAMEPLAY_TAGS;

const COMPONENT_BITS: readonly { bit: number; name: string }[] = [
  { bit: HAS_ABILITY_SYSTEM, name: 'AbilitySystem' },
  { bit: HAS_ATTRIBUTES, name: 'Attributes' },
  { bit: HAS_ACTIVE_EFFECTS, name: 'ActiveEffects' },
  { bit: HAS_GAMEPLAY_TAGS, name: 'GameplayTags' },
];

const PROVIDED_ENTITY = 1;
const PROVIDED_X = 2;
const PROVIDED_Z = 4;
const KNOWN_PROVIDED_FLAGS = PROVIDED_ENTITY | PROVIDED_X | PROVIDED_Z;

const ABSENT = 0;
const PRESENT = 1;

const VALUE_INT = 1;
const VALUE_BIGINT = 2;
const VALUE_STRING = 3;
const VALUE_BOOL = 4;
const VALUE_FP = 5;

interface AbilityStateIO {
  exportRuntimeState(): AbilityRuntimeState;
  importRuntimeState(state: AbilityRuntimeState): void;
}

interface FixedPointShape {
  readonly base: bigint;
  readonly precision: bigint;
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
    typeof record['importRuntimeState'] === 'function'
  );
}

function componentFlags(entity: Entity): number {
  let flags = 0;
  if (entity.hasComponent(AbilitiesComponentType.AbilitySystem)) {
    flags |= HAS_ABILITY_SYSTEM;
  }
  if (entity.hasComponent(AbilitiesComponentType.Attributes)) {
    flags |= HAS_ATTRIBUTES;
  }
  if (entity.hasComponent(AbilitiesComponentType.ActiveEffects)) {
    flags |= HAS_ACTIVE_EFFECTS;
  }
  if (entity.hasComponent(AbilitiesComponentType.GameplayTags)) {
    flags |= HAS_GAMEPLAY_TAGS;
  }
  return flags;
}

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

function compareUtf16(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function asFixedPoint(value: unknown): FixedPointShape | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const base = record['base'];
  const precision = record['precision'];
  if (typeof base !== 'bigint' || typeof precision !== 'bigint') {
    return undefined;
  }
  return { base, precision };
}

function writeFixedPoint(w: StateWriter, fp: FixedPointShape): void {
  const precision = Number(fp.precision);
  if (!Number.isSafeInteger(precision) || precision < 0) {
    throw new Error(
      'writeAbilities: fixed-point precision is not a non-negative integer'
    );
  }
  w.i64(fp.base);
  w.varint(precision);
}

function readFixedPoint(r: StateReader): FixedPoint {
  const base = r.i64();
  const precision = r.varint();
  return FP.FromRaw(base, precision);
}

function requireFixedPoint(value: unknown, label: string): FixedPointShape {
  const fp = asFixedPoint(value);
  if (fp === undefined) {
    throw new Error(`writeAbilities: ${label} must be a FixedPoint`);
  }
  return fp;
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

function writeAttributes(
  w: StateWriter,
  attributes: AttributesComponent
): void {
  const count = attributes.base.length;
  if (
    attributes.current.length !== count ||
    attributes.dirty.length !== count
  ) {
    throw new Error('writeAbilities: attribute arrays have different lengths');
  }
  w.varint(count);
  for (let index = 0; index < count; index += 1) {
    const base = attributes.base[index];
    const current = attributes.current[index];
    const dirty = attributes.dirty[index];
    if (base === undefined || current === undefined || dirty === undefined) {
      throw new Error('writeAbilities: attribute index out of range');
    }
    w.i64(base);
    w.i64(current);
    w.u8(dirty);
  }
}

function readAttributeValues(
  r: StateReader,
  attributes: AttributesComponent,
  count: number,
  entityId: number
): void {
  if (
    attributes.base.length !== count ||
    attributes.current.length !== count ||
    attributes.dirty.length !== count
  ) {
    throw new Error(
      `readAbilities: attribute count ${String(count)} does not match component length ${String(attributes.base.length)} on entity ${String(entityId)}`
    );
  }
  for (let index = 0; index < count; index += 1) {
    attributes.base[index] = r.i64();
    attributes.current[index] = r.i64();
    attributes.dirty[index] = r.u8();
  }
}

function writeCapturedMagnitudes(
  w: StateWriter,
  magnitudes: ActiveEffectInstance['capturedMagnitudes']
): void {
  if (magnitudes === undefined || magnitudes === null) {
    w.u8(ABSENT);
    return;
  }
  w.u8(PRESENT);
  w.list(magnitudes, (magnitude, item) => {
    writeFixedPoint(
      item,
      requireFixedPoint(magnitude, 'capturedMagnitudes entry')
    );
  });
}

function readCapturedMagnitudes(r: StateReader): FixedPoint[] | null {
  const tag = r.u8();
  if (tag === ABSENT) return null;
  if (tag !== PRESENT) {
    throw new Error(
      `readAbilities: unknown capturedMagnitudes tag ${String(tag)}`
    );
  }
  return r.list((item) => readFixedPoint(item));
}

function writeActiveEffect(
  w: StateWriter,
  instance: ActiveEffectInstance
): void {
  w.varint(instance.instanceId);
  w.str(instance.defId);
  w.i32(instance.sourceEntityId);
  w.i32(instance.remainingTicks);
  w.i32(instance.nextPeriodTick);
  w.i32(instance.enteredOnTick);
  writeCapturedMagnitudes(w, instance.capturedMagnitudes);
}

function readActiveEffect(r: StateReader): ActiveEffectInstance {
  const instance: ActiveEffectInstance = {
    instanceId: r.varint(),
    defId: r.str(),
    sourceEntityId: r.i32(),
    remainingTicks: r.i32(),
    nextPeriodTick: r.i32(),
    enteredOnTick: r.i32(),
    capturedMagnitudes: readCapturedMagnitudes(r),
  };
  return instance;
}

function writeSetByCallerValue(
  w: StateWriter,
  key: string,
  value: unknown
): void {
  if (typeof value === 'string') {
    w.u8(VALUE_STRING);
    w.str(value);
    return;
  }
  if (typeof value === 'boolean') {
    w.u8(VALUE_BOOL);
    w.bool(value);
    return;
  }
  if (typeof value === 'bigint') {
    w.u8(VALUE_BIGINT);
    w.i64(value);
    return;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    w.u8(VALUE_INT);
    w.i64(BigInt(value));
    return;
  }
  const fp = asFixedPoint(value);
  if (fp !== undefined) {
    w.u8(VALUE_FP);
    writeFixedPoint(w, fp);
    return;
  }
  const typeName = value === null ? 'null' : typeof value;
  throw new Error(
    `writeAbilities: unsupported setByCaller value for '${key}' (${typeName})`
  );
}

function readSetByCallerValue(r: StateReader, key: string): unknown {
  const kind = r.u8();
  switch (kind) {
    case VALUE_INT: {
      const raw = r.i64();
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || BigInt(value) !== raw) {
        throw new Error(
          `readAbilities: setByCaller '${key}' integer does not fit a safe integer`
        );
      }
      return value;
    }
    case VALUE_BIGINT:
      return r.i64();
    case VALUE_STRING:
      return r.str();
    case VALUE_BOOL:
      return r.bool();
    case VALUE_FP:
      return readFixedPoint(r);
    default:
      throw new Error(
        `readAbilities: unknown setByCaller value kind ${String(kind)} for '${key}'`
      );
  }
}

function writeSetByCaller(
  w: StateWriter,
  payload: PendingEffectAdd['setByCaller']
): void {
  if (payload === undefined || payload === null) {
    w.u8(ABSENT);
    return;
  }
  w.u8(PRESENT);
  const keys = Array.from(payload.keys()).sort(compareUtf16);
  w.list(keys, (key, item) => {
    item.str(key);
    writeSetByCallerValue(item, key, payload.get(key));
  });
}

function readSetByCaller(r: StateReader): Map<string, unknown> | null {
  const tag = r.u8();
  if (tag === ABSENT) return null;
  if (tag !== PRESENT) {
    throw new Error(`readAbilities: unknown setByCaller tag ${String(tag)}`);
  }
  const entries = r.list((item) => {
    const key = item.str();
    return { key, value: readSetByCallerValue(item, key) };
  });
  const map = new Map<string, unknown>();
  for (const entry of entries) map.set(entry.key, entry.value);
  return map;
}

function writeActiveEffects(
  w: StateWriter,
  effects: ActiveEffectsComponent
): void {
  w.list(effects.queue, (instance, item) => {
    writeActiveEffect(item, instance);
  });
  w.list(effects.pendingAdd, (pending, item) => {
    item.str(pending.defId);
    item.i32(pending.sourceEntityId);
    writeSetByCaller(item, pending.setByCaller);
  });
}

function readActiveEffects(
  r: StateReader,
  effects: ActiveEffectsComponent
): void {
  const queue = r.list((item) => readActiveEffect(item));
  const pending = r.list((item): PendingEffectAdd => {
    return {
      defId: item.str(),
      sourceEntityId: item.i32(),
      setByCaller: readSetByCaller(item),
    };
  });
  effects.queue.splice(0, effects.queue.length, ...queue);
  effects.pendingAdd.splice(0, effects.pendingAdd.length, ...pending);
}

function writeTags(w: StateWriter, tags: GameplayTagsComponent): void {
  w.list(Array.from(tags.tags), (tag, item) => {
    item.str(tag);
  });
  w.list(Array.from(tags.adHocTags), (tag, item) => {
    item.str(tag);
  });
  w.list(Array.from(tags.effectGrantCounts.entries()), (entry, item) => {
    item.str(entry[0]);
    item.varint(entry[1]);
  });
}

function readTags(r: StateReader, tags: GameplayTagsComponent): void {
  const tagList = r.list((item) => item.str());
  const adHoc = r.list((item) => item.str());
  const grants = r.list((item) => {
    const tag = item.str();
    return { tag, count: item.varint() };
  });
  tags.tags.clear();
  tags.adHocTags.clear();
  tags.effectGrantCounts.clear();
  for (const tag of tagList) tags.tags.add(tag);
  for (const tag of adHoc) tags.adHocTags.add(tag);
  for (const grant of grants)
    tags.effectGrantCounts.set(grant.tag, grant.count);
}

function writeAbilitySystem(
  w: StateWriter,
  component: AbilitySystemComponent
): void {
  w.list(Array.from(component.abilities), (abilityId, item) => {
    item.str(abilityId);
  });
  writeAttributes(w, component.attributes);
  writeActiveEffects(w, component.activeEffects);
  writeTags(w, component.tags);
}

function readAbilitySystem(
  r: StateReader,
  entity: Entity,
  world: GameWorld
): void {
  const abilityIds = r.list((item) => item.str());
  const count = r.varint();
  let component = entity.getComponent<AbilitySystemComponent>(
    AbilitiesComponentType.AbilitySystem
  );
  if (component === undefined) {
    component = new AbilitySystemComponent(count);
    entity.addComponent(component);
    world.entityManager.onComponentAdded(entity, component.type);
  }
  readAttributeValues(r, component.attributes, count, entity.id);
  readActiveEffects(r, component.activeEffects);
  readTags(r, component.tags);
  component.abilities.clear();
  for (const abilityId of abilityIds) component.abilities.add(abilityId);
}

function readStandaloneAttributes(
  r: StateReader,
  entity: Entity,
  world: GameWorld
): void {
  const count = r.varint();
  let attributes = entity.getComponent<AttributesComponent>(
    AbilitiesComponentType.Attributes
  );
  if (attributes === undefined) {
    attributes = new AttributesComponent(count);
    entity.addComponent(attributes);
    world.entityManager.onComponentAdded(entity, attributes.type);
  }
  readAttributeValues(r, attributes, count, entity.id);
}

function readStandaloneEffects(
  r: StateReader,
  entity: Entity,
  world: GameWorld
): void {
  let effects = entity.getComponent<ActiveEffectsComponent>(
    AbilitiesComponentType.ActiveEffects
  );
  if (effects === undefined) {
    effects = new ActiveEffectsComponent();
    entity.addComponent(effects);
    world.entityManager.onComponentAdded(entity, effects.type);
  }
  readActiveEffects(r, effects);
}

function readStandaloneTags(
  r: StateReader,
  entity: Entity,
  world: GameWorld
): void {
  let tags = entity.getComponent<GameplayTagsComponent>(
    AbilitiesComponentType.GameplayTags
  );
  if (tags === undefined) {
    tags = new GameplayTagsComponent();
    entity.addComponent(tags);
    world.entityManager.onComponentAdded(entity, tags.type);
  }
  readTags(r, tags);
}

function writeEntityGas(w: StateWriter, entity: Entity): void {
  const flags = componentFlags(entity);
  w.u32(entity.id);
  w.u8(flags);
  if ((flags & HAS_ABILITY_SYSTEM) !== 0) {
    const component = entity.getComponent<AbilitySystemComponent>(
      AbilitiesComponentType.AbilitySystem
    );
    if (component === undefined) {
      throw new Error(
        `writeAbilities: missing AbilitySystem on entity ${String(entity.id)}`
      );
    }
    writeAbilitySystem(w, component);
  }
  if ((flags & HAS_ATTRIBUTES) !== 0) {
    const attributes = entity.getComponent<AttributesComponent>(
      AbilitiesComponentType.Attributes
    );
    if (attributes === undefined) {
      throw new Error(
        `writeAbilities: missing Attributes on entity ${String(entity.id)}`
      );
    }
    writeAttributes(w, attributes);
  }
  if ((flags & HAS_ACTIVE_EFFECTS) !== 0) {
    const effects = entity.getComponent<ActiveEffectsComponent>(
      AbilitiesComponentType.ActiveEffects
    );
    if (effects === undefined) {
      throw new Error(
        `writeAbilities: missing ActiveEffects on entity ${String(entity.id)}`
      );
    }
    writeActiveEffects(w, effects);
  }
  if ((flags & HAS_GAMEPLAY_TAGS) !== 0) {
    const tags = entity.getComponent<GameplayTagsComponent>(
      AbilitiesComponentType.GameplayTags
    );
    if (tags === undefined) {
      throw new Error(
        `writeAbilities: missing GameplayTags on entity ${String(entity.id)}`
      );
    }
    writeTags(w, tags);
  }
}

function readEntityGas(
  r: StateReader,
  world: GameWorld,
  seen: Set<number>
): void {
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
  if ((flags & HAS_ABILITY_SYSTEM) !== 0) readAbilitySystem(r, entity, world);
  if ((flags & HAS_ATTRIBUTES) !== 0)
    readStandaloneAttributes(r, entity, world);
  if ((flags & HAS_ACTIVE_EFFECTS) !== 0)
    readStandaloneEffects(r, entity, world);
  if ((flags & HAS_GAMEPLAY_TAGS) !== 0) readStandaloneTags(r, entity, world);
}

/** `section('gas', 1)`: per-world runtime, then GAS entities by id. */
export function writeAbilities(w: StateWriter, world: GameWorld): void {
  const abilities = abilityStateIO(world, 'writeAbilities');
  w.section(GAS_SECTION, HELPER_SECTION_VERSION, (section) => {
    writeRuntime(section, abilities.exportRuntimeState());
    section.sortedBy(
      gasEntities(world),
      (entity) => entity.id,
      (entity, item) => {
        writeEntityGas(item, entity);
      }
    );
  });
}

/**
 * Restores {@link writeAbilities}.
 *
 * Entities must already exist (`spawnWithId` / `readPools`). Components the
 * snapshot lists and the entity does not have yet are created. A component
 * the snapshot omits, or an entity the snapshot omits, throws.
 */
export function readAbilities(r: StateReader, world: GameWorld): void {
  const abilities = abilityStateIO(world, 'readAbilities');
  const seen = new Set<number>();
  r.section(GAS_SECTION, (section, version) => {
    assertSectionVersion('readAbilities', version);
    abilities.importRuntimeState(readRuntime(section));
    section.list((item) => {
      readEntityGas(item, world, seen);
      return 0;
    });
  });
  for (const entity of gasEntities(world)) {
    if (!seen.has(entity.id)) {
      throw new Error(`readAbilities: extra entity ${String(entity.id)}`);
    }
  }
}
