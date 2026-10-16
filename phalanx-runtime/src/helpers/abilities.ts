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
import { FixedPoint } from '@phalanx-engine/math';
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
 * - Component `type` symbols (the class constructor sets them).
 * - There is no `stacks` field and no cooldown component. Cooldowns are
 *   duration effects plus tags.
 *
 * Destroyed entities are omitted, matching ability-system queries.
 * Free-list entities are not registered, so they are omitted too. Returning
 * an entity to the pool clears its effect queue and `pendingAdd`, then
 * copies the factory shell back (`releasePooledAbilityState`): attribute
 * `base` / `current` / `dirty`, the equipped ability set, and ad-hoc tags
 * plus effect grants from construction (`initComponent` tags included).
 * Components attached after that shell are removed. Initial `pendingAdd`
 * effects are not part of the shell, so `onSpawn` must re-seed those.
 * A respawn whose `onSpawn` does not rewrite attributes still matches a
 * restored copy, because restore builds a fresh factory instance and runs
 * the same hook.
 *
 * `readAbilities` parses and validates the whole section before it mutates
 * the world. An unknown ability id or effect def id throws with the entity
 * id. The instance-id counter must be >= every queued effect instance id.
 * Pending adds have no instance id, so they do not raise that floor.
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
  isAbilityRegistered(abilityId: string): boolean;
  isEffectRegistered(effectId: string): boolean;
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
    typeof record['importRuntimeState'] === 'function' &&
    typeof record['isAbilityRegistered'] === 'function' &&
    typeof record['isEffectRegistered'] === 'function'
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

/**
 * Raw base and the value's own precision, both `i64`.
 *
 * Same encoding as `writeBroadphase`. `FP.FromRaw` would default a missing
 * precision to 5 and is not used here.
 */
function writeFixedPoint(w: StateWriter, fp: FixedPointShape): void {
  if (fp.precision < 0n) {
    throw new Error(
      'writeAbilities: fixed-point precision is not a non-negative integer'
    );
  }
  w.i64(fp.base);
  w.i64(fp.precision);
}

function readFixedPoint(r: StateReader): FixedPoint {
  const base = r.i64();
  const precision = r.i64();
  if (precision < 0n) {
    throw new Error(
      'readAbilities: fixed-point precision is not a non-negative integer'
    );
  }
  return new FixedPoint(base, precision);
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

interface ParsedAttributes {
  readonly count: number;
  readonly base: bigint[];
  readonly current: bigint[];
  readonly dirty: number[];
}

function readParsedAttributes(
  r: StateReader,
  entityId: number,
  existing: AttributesComponent | undefined
): ParsedAttributes {
  const count = r.varint();
  if (
    existing !== undefined &&
    (existing.base.length !== count ||
      existing.current.length !== count ||
      existing.dirty.length !== count)
  ) {
    throw new Error(
      `readAbilities: attribute count ${String(count)} does not match component length ${String(existing.base.length)} on entity ${String(entityId)}`
    );
  }
  const base: bigint[] = [];
  const current: bigint[] = [];
  const dirty: number[] = [];
  for (let index = 0; index < count; index += 1) {
    base.push(r.i64());
    current.push(r.i64());
    dirty.push(r.u8());
  }
  return { count, base, current, dirty };
}

function applyAttributes(
  attributes: AttributesComponent,
  parsed: ParsedAttributes
): void {
  for (let index = 0; index < parsed.count; index += 1) {
    const base = parsed.base[index];
    const current = parsed.current[index];
    const dirty = parsed.dirty[index];
    if (base === undefined || current === undefined || dirty === undefined) {
      throw new Error('readAbilities: attribute index out of range');
    }
    attributes.base[index] = base;
    attributes.current[index] = current;
    attributes.dirty[index] = dirty;
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

function assertRegisteredAbility(
  abilities: AbilityStateIO,
  abilityId: string,
  entityId: number
): void {
  if (!abilities.isAbilityRegistered(abilityId)) {
    throw new Error(
      `readAbilities: ability '${abilityId}' is not registered on entity ${String(entityId)}`
    );
  }
}

function readActiveEffect(
  r: StateReader,
  entityId: number,
  abilities: AbilityStateIO
): ActiveEffectInstance {
  const instance: ActiveEffectInstance = {
    instanceId: r.varint(),
    defId: r.str(),
    sourceEntityId: r.i32(),
    remainingTicks: r.i32(),
    nextPeriodTick: r.i32(),
    enteredOnTick: r.i32(),
    capturedMagnitudes: readCapturedMagnitudes(r),
  };
  assertRegisteredEffect(abilities, instance.defId, entityId);
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

interface ParsedEffects {
  readonly queue: ActiveEffectInstance[];
  readonly pendingAdd: PendingEffectAdd[];
}

function readParsedEffects(
  r: StateReader,
  entityId: number,
  abilities: AbilityStateIO
): ParsedEffects {
  const queue = r.list((item) => readActiveEffect(item, entityId, abilities));
  const pendingAdd = r.list((item): PendingEffectAdd => {
    const defId = item.str();
    assertRegisteredEffect(abilities, defId, entityId);
    return {
      defId,
      sourceEntityId: item.i32(),
      setByCaller: readSetByCaller(item),
    };
  });
  return { queue, pendingAdd };
}

function applyEffects(
  effects: ActiveEffectsComponent,
  parsed: ParsedEffects
): void {
  // Keep the existing arrays. Spreading either list into `splice` throws
  // once the list exceeds the engine argument limit.
  effects.queue.length = 0;
  for (let index = 0; index < parsed.queue.length; index += 1) {
    const instance = parsed.queue[index];
    if (instance !== undefined) effects.queue.push(instance);
  }
  effects.pendingAdd.length = 0;
  for (let index = 0; index < parsed.pendingAdd.length; index += 1) {
    const pending = parsed.pendingAdd[index];
    if (pending !== undefined) effects.pendingAdd.push(pending);
  }
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

interface ParsedTags {
  readonly tags: string[];
  readonly adHocTags: string[];
  readonly grants: { readonly tag: string; readonly count: number }[];
}

function readParsedTags(r: StateReader): ParsedTags {
  const tags = r.list((item) => item.str());
  const adHocTags = r.list((item) => item.str());
  const grants = r.list((item) => {
    const tag = item.str();
    return { tag, count: item.varint() };
  });
  return { tags, adHocTags, grants };
}

function applyTags(tags: GameplayTagsComponent, parsed: ParsedTags): void {
  tags.tags.clear();
  tags.adHocTags.clear();
  tags.effectGrantCounts.clear();
  for (const tag of parsed.tags) tags.tags.add(tag);
  for (const tag of parsed.adHocTags) tags.adHocTags.add(tag);
  for (const grant of parsed.grants) {
    tags.effectGrantCounts.set(grant.tag, grant.count);
  }
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

interface ParsedAbilitySystem {
  readonly abilityIds: string[];
  readonly attributes: ParsedAttributes;
  readonly effects: ParsedEffects;
  readonly tags: ParsedTags;
}

function readParsedAbilitySystem(
  r: StateReader,
  entity: Entity,
  abilities: AbilityStateIO
): ParsedAbilitySystem {
  const abilityIds = r.list((item) => {
    const abilityId = item.str();
    assertRegisteredAbility(abilities, abilityId, entity.id);
    return abilityId;
  });
  const existing = entity.getComponent<AbilitySystemComponent>(
    AbilitiesComponentType.AbilitySystem
  );
  const attributes = readParsedAttributes(r, entity.id, existing?.attributes);
  const effects = readParsedEffects(r, entity.id, abilities);
  const tags = readParsedTags(r);
  return { abilityIds, attributes, effects, tags };
}

function readParsedStandaloneAttributes(
  r: StateReader,
  entity: Entity
): ParsedAttributes {
  const existing = entity.getComponent<AttributesComponent>(
    AbilitiesComponentType.Attributes
  );
  return readParsedAttributes(r, entity.id, existing);
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

interface ParsedEntityGas {
  readonly entityId: number;
  readonly flags: number;
  readonly abilitySystem?: ParsedAbilitySystem;
  readonly attributes?: ParsedAttributes;
  readonly effects?: ParsedEffects;
  readonly tags?: ParsedTags;
}

interface ParsedGas {
  readonly runtime: AbilityRuntimeState;
  readonly entities: ParsedEntityGas[];
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
  // Property order is the byte order: ability system, then each standalone.
  return {
    entityId,
    flags,
    abilitySystem:
      (flags & HAS_ABILITY_SYSTEM) !== 0
        ? readParsedAbilitySystem(r, entity, abilities)
        : undefined,
    attributes:
      (flags & HAS_ATTRIBUTES) !== 0
        ? readParsedStandaloneAttributes(r, entity)
        : undefined,
    effects:
      (flags & HAS_ACTIVE_EFFECTS) !== 0
        ? readParsedEffects(r, entityId, abilities)
        : undefined,
    tags: (flags & HAS_GAMEPLAY_TAGS) !== 0 ? readParsedTags(r) : undefined,
  };
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
 * The counter must cover every effect instance id already in a queue.
 * Pending adds do not carry an instance id; the next drain allocates one.
 */
function assertInstanceIdBound(parsed: ParsedGas): void {
  let max = -1;
  let entityId = -1;
  for (const entity of parsed.entities) {
    const queues = [entity.abilitySystem?.effects.queue, entity.effects?.queue];
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

function applyAbilitySystem(
  world: GameWorld,
  entity: Entity,
  parsed: ParsedAbilitySystem
): void {
  let component = entity.getComponent<AbilitySystemComponent>(
    AbilitiesComponentType.AbilitySystem
  );
  if (component === undefined) {
    component = new AbilitySystemComponent(parsed.attributes.count);
    entity.addComponent(component);
    world.entityManager.onComponentAdded(entity, component.type);
  }
  applyAttributes(component.attributes, parsed.attributes);
  applyEffects(component.activeEffects, parsed.effects);
  applyTags(component.tags, parsed.tags);
  component.abilities.clear();
  for (const abilityId of parsed.abilityIds) {
    component.abilities.add(abilityId);
  }
}

function applyStandaloneAttributes(
  world: GameWorld,
  entity: Entity,
  parsed: ParsedAttributes
): void {
  let attributes = entity.getComponent<AttributesComponent>(
    AbilitiesComponentType.Attributes
  );
  if (attributes === undefined) {
    attributes = new AttributesComponent(parsed.count);
    entity.addComponent(attributes);
    world.entityManager.onComponentAdded(entity, attributes.type);
  }
  applyAttributes(attributes, parsed);
}

function applyStandaloneEffects(
  world: GameWorld,
  entity: Entity,
  parsed: ParsedEffects
): void {
  let effects = entity.getComponent<ActiveEffectsComponent>(
    AbilitiesComponentType.ActiveEffects
  );
  if (effects === undefined) {
    effects = new ActiveEffectsComponent();
    entity.addComponent(effects);
    world.entityManager.onComponentAdded(entity, effects.type);
  }
  applyEffects(effects, parsed);
}

function applyStandaloneTags(
  world: GameWorld,
  entity: Entity,
  parsed: ParsedTags
): void {
  let tags = entity.getComponent<GameplayTagsComponent>(
    AbilitiesComponentType.GameplayTags
  );
  if (tags === undefined) {
    tags = new GameplayTagsComponent();
    entity.addComponent(tags);
    world.entityManager.onComponentAdded(entity, tags.type);
  }
  applyTags(tags, parsed);
}

function applyEntityGas(world: GameWorld, parsed: ParsedEntityGas): void {
  const entity = world.entityManager.getEntity(parsed.entityId);
  if (entity === undefined) {
    throw new Error(`readAbilities: missing entity ${String(parsed.entityId)}`);
  }
  if (parsed.abilitySystem !== undefined) {
    applyAbilitySystem(world, entity, parsed.abilitySystem);
  }
  if (parsed.attributes !== undefined) {
    applyStandaloneAttributes(world, entity, parsed.attributes);
  }
  if (parsed.effects !== undefined) {
    applyStandaloneEffects(world, entity, parsed.effects);
  }
  if (parsed.tags !== undefined) {
    applyStandaloneTags(world, entity, parsed.tags);
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
  const parsed = r.section(GAS_SECTION, (section, version): ParsedGas => {
    assertSectionVersion('readAbilities', version);
    const runtime = readRuntime(section);
    const entities = section.list((item) =>
      readParsedEntity(item, world, abilities, seen)
    );
    return { runtime, entities };
  });
  assertInstanceIdBound(parsed);
  assertNoExtraGasEntities(world, seen);
  abilities.importRuntimeState(parsed.runtime);
  for (const entity of parsed.entities) {
    applyEntityGas(world, entity);
  }
}
