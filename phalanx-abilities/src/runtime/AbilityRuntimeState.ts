import type { FixedPoint } from '@phalanx-engine/math';
import type { ProvidedTarget } from '../types';
import type {
  AbilityActivationRequest,
  AbilitySystemRuntime,
  ResolvedAbilityActivationRecord,
} from './AbilitySystemRuntime';

/**
 * Snapshot of the per-world ability runtime.
 *
 * The gameplay cue buffer is presentation-only and is intentionally absent.
 * `resolvedActivationsThisTick` is empty between ticks; it is still stored
 * so a snapshot taken mid-pipeline round-trips.
 */
export interface AbilityRuntimeState {
  /**
   * High-water mark of allocated effect instance ids.
   *
   * Must be greater than or equal to every live instance id. That bound
   * is the caller's responsibility: import accepts a lower integer, and
   * the next allocation can then collide with an id that is still in use.
   */
  readonly instanceId: number;
  readonly currentTick: number;
  readonly activationRequests: readonly AbilityActivationRequest[];
  readonly resolvedActivationsThisTick: readonly ResolvedAbilityActivationRecord[];
}

export function exportAbilityRuntimeState(
  runtime: AbilitySystemRuntime
): AbilityRuntimeState {
  return {
    instanceId: runtime.instanceIdCounter.current,
    currentTick: runtime.currentTick,
    activationRequests: runtime.activationRequests.map(copyActivationRequest),
    resolvedActivationsThisTick: runtime.resolvedActivationsThisTick.map(
      copyResolvedActivation
    ),
  };
}

/** Ability registry view used to reject unknown ids on import. */
interface AbilityIdLookup {
  has(abilityId: string): boolean;
}

/**
 * Replace sim-relevant runtime fields. Leaves `gameplayCueBuffer` as it is.
 *
 * `state.instanceId` must be greater than or equal to every live effect
 * instance id. That bound is the caller's responsibility: a lower integer
 * is stored, and the next allocation can collide with an id still in use.
 *
 * Every `abilityId` must be present in `abilities`.
 *
 * @throws If `state` is missing a field, a field has the wrong shape, or
 * an ability id is not registered.
 */
export function importAbilityRuntimeState(
  runtime: AbilitySystemRuntime,
  state: AbilityRuntimeState,
  abilities: AbilityIdLookup
): void {
  const parsed = parseAbilityRuntimeState(state, abilities);
  runtime.instanceIdCounter.set(parsed.instanceId);
  runtime.currentTick = parsed.currentTick;
  runtime.activationRequests = parsed.activationRequests;
  runtime.resolvedActivationsThisTick = parsed.resolvedActivationsThisTick;
}

function copyActivationRequest(
  request: AbilityActivationRequest
): AbilityActivationRequest {
  const copy: AbilityActivationRequest = {
    casterEntityId: request.casterEntityId,
    abilityId: request.abilityId,
    enqueueTick: request.enqueueTick,
  };
  if (request.providedTarget !== undefined) {
    copy.providedTarget = copyProvidedTarget(request.providedTarget);
  }
  return copy;
}

function copyResolvedActivation(
  record: ResolvedAbilityActivationRecord
): ResolvedAbilityActivationRecord {
  const copy: ResolvedAbilityActivationRecord = {
    abilityId: record.abilityId,
    casterEntityId: record.casterEntityId,
    resolvedTargets: [...record.resolvedTargets],
    tick: record.tick,
  };
  if (record.providedTarget !== undefined) {
    copy.providedTarget = copyProvidedTarget(record.providedTarget);
  }
  if (record.hookId !== undefined) {
    copy.hookId = record.hookId;
  }
  return copy;
}

function copyProvidedTarget(target: ProvidedTarget): ProvidedTarget {
  const copy: ProvidedTarget = {};
  if (target.entityId !== undefined) {
    copy.entityId = target.entityId;
  }
  if (target.x !== undefined) {
    copy.x = target.x;
  }
  if (target.z !== undefined) {
    copy.z = target.z;
  }
  return copy;
}

interface ParsedAbilityRuntimeState {
  instanceId: number;
  currentTick: number;
  activationRequests: AbilityActivationRequest[];
  resolvedActivationsThisTick: ResolvedAbilityActivationRecord[];
}

function parseAbilityRuntimeState(
  state: unknown,
  abilities: AbilityIdLookup
): ParsedAbilityRuntimeState {
  if (!isRecord(state)) {
    throw new Error('AbilityRuntimeState must be an object');
  }
  const instanceId = state['instanceId'];
  const currentTick = state['currentTick'];
  const requests = state['activationRequests'];
  const resolved = state['resolvedActivationsThisTick'];
  if (!isNonNegativeInteger(instanceId)) {
    throw new Error('AbilityRuntimeState.instanceId must be an integer >= 0');
  }
  if (!isTick(currentTick)) {
    throw new Error('AbilityRuntimeState.currentTick must be an integer >= -1');
  }
  if (!Array.isArray(requests)) {
    throw new Error('AbilityRuntimeState.activationRequests must be an array');
  }
  if (!Array.isArray(resolved)) {
    throw new Error(
      'AbilityRuntimeState.resolvedActivationsThisTick must be an array'
    );
  }
  return {
    instanceId,
    currentTick,
    activationRequests: requests.map((request, index) =>
      readActivationRequest(request, index, abilities)
    ),
    resolvedActivationsThisTick: resolved.map((record, index) =>
      readResolvedActivation(record, index, abilities)
    ),
  };
}

function readActivationRequest(
  value: unknown,
  index: number,
  abilities: AbilityIdLookup
): AbilityActivationRequest {
  const label = `AbilityRuntimeState.activationRequests[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const casterEntityId = value['casterEntityId'];
  const abilityId = value['abilityId'];
  const enqueueTick = value['enqueueTick'];
  if (!isNonNegativeInteger(casterEntityId)) {
    throw new Error(`${label}.casterEntityId must be an integer >= 0`);
  }
  if (typeof abilityId !== 'string') {
    throw new Error(`${label}.abilityId must be a string`);
  }
  assertRegisteredAbility(abilityId, abilities, label);
  if (!isTick(enqueueTick)) {
    throw new Error(`${label}.enqueueTick must be an integer >= -1`);
  }
  const request: AbilityActivationRequest = {
    casterEntityId,
    abilityId,
    enqueueTick,
  };
  const providedTarget = readProvidedTarget(
    value['providedTarget'],
    `${label}.providedTarget`
  );
  if (providedTarget !== undefined) {
    request.providedTarget = providedTarget;
  }
  return request;
}

function readResolvedActivation(
  value: unknown,
  index: number,
  abilities: AbilityIdLookup
): ResolvedAbilityActivationRecord {
  const label = `AbilityRuntimeState.resolvedActivationsThisTick[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const abilityId = value['abilityId'];
  const casterEntityId = value['casterEntityId'];
  const tick = value['tick'];
  const targets = value['resolvedTargets'];
  if (typeof abilityId !== 'string') {
    throw new Error(`${label}.abilityId must be a string`);
  }
  assertRegisteredAbility(abilityId, abilities, label);
  if (!isNonNegativeInteger(casterEntityId)) {
    throw new Error(`${label}.casterEntityId must be an integer >= 0`);
  }
  if (!isTick(tick)) {
    throw new Error(`${label}.tick must be an integer >= -1`);
  }
  if (!Array.isArray(targets)) {
    throw new Error(`${label}.resolvedTargets must be an array`);
  }
  const resolvedTargets: number[] = [];
  for (const id of targets) {
    if (!isNonNegativeInteger(id)) {
      throw new Error(`${label}.resolvedTargets must contain integers >= 0`);
    }
    resolvedTargets.push(id);
  }
  const record: ResolvedAbilityActivationRecord = {
    abilityId,
    casterEntityId,
    resolvedTargets,
    tick,
  };
  const providedTarget = readProvidedTarget(
    value['providedTarget'],
    `${label}.providedTarget`
  );
  if (providedTarget !== undefined) {
    record.providedTarget = providedTarget;
  }
  const hookId = value['hookId'];
  if (hookId !== undefined) {
    if (typeof hookId !== 'string') {
      throw new Error(`${label}.hookId must be a string`);
    }
    record.hookId = hookId;
  }
  return record;
}

function readProvidedTarget(
  value: unknown,
  label: string
): ProvidedTarget | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const copy: ProvidedTarget = {};
  const entityId = value['entityId'];
  if (entityId !== undefined) {
    if (!isNonNegativeInteger(entityId)) {
      throw new Error(`${label}.entityId must be an integer >= 0`);
    }
    copy.entityId = entityId;
  }
  const x = value['x'];
  if (x !== undefined) {
    if (!isFixedPoint(x)) {
      throw new Error(`${label}.x must be a FixedPoint`);
    }
    copy.x = x;
  }
  const z = value['z'];
  if (z !== undefined) {
    if (!isFixedPoint(z)) {
      throw new Error(`${label}.z must be a FixedPoint`);
    }
    copy.z = z;
  }
  return copy;
}

/**
 * Shape check, not `instanceof`. A bundled game can load two copies of
 * `@phalanx-engine/math`, and a FixedPoint from the other copy is still
 * a fixed-point value (`base` and `precision` bigints).
 */
function isFixedPoint(value: unknown): value is FixedPoint {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value['base'] === 'bigint' && typeof value['precision'] === 'bigint'
  );
}

function assertRegisteredAbility(
  abilityId: string,
  abilities: AbilityIdLookup,
  label: string
): void {
  if (!abilities.has(abilityId)) {
    throw new Error(`${label}.abilityId is not registered: ${abilityId}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTick(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= -1
  );
}
