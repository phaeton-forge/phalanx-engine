import type { ProvidedTarget } from '../types';
import { InstanceIdCounter } from './InstanceIdCounter';

/**
 * In-tick handoff between {@link AbilityActivationSystem} and
 * {@link AbilityHookExecutorSystem}. Populated by activation, drained by
 * the executor later in the same tick.
 *
 * Held on the runtime so two systems running on different `processTick`
 * passes share one buffer without an extra constructor wiring step. The
 * shape is intentionally minimal — it should not accumulate fields that
 * make sense as event payloads instead (use {@link AbilityActivatedEvent}
 * for those).
 */
export interface ResolvedAbilityActivationRecord {
  abilityId: string;
  casterEntityId: number;
  resolvedTargets: number[];
  providedTarget?: ProvidedTarget;
  hookId?: string;
  tick: number;
}

/**
 * Enqueued by {@link AbilitySystemFacade.activateAbility}, drained by
 * {@link AbilityActivationSystem} on the next tick.
 *
 * Held on the per-world runtime (not on a component) for two reasons:
 *  1. The facade is `not` a `GameSystem`; even though it may use the entity
 *     manager for lookups/component creation, the runtime remains the owner
 *     of mutable per-world execution state, which keeps this queue out of the
 *     registries the facade already holds.
 *  2. A single FIFO queue across all casters gives us a deterministic global
 *     order without an extra singleton entity. The drain pass iterates in
 *     enqueue order; the system itself decides whether to spread requests
 *     across casters in the same tick.
 *
 * `enqueueTick` records the tick on which the request was created, which is
 * `-1` if the facade is called before the first tick. The system only acts on
 * requests whose `enqueueTick !== currentTick` — i.e. the next tick. This
 * matches the existing `pendingAdd` discipline in
 * {@link ActiveEffectsComponent}: writes from "this tick's user code" land on
 * "the next tick's drain pass", which is the contract `applyEffect` already
 * promises.
 */
export interface AbilityActivationRequest {
  casterEntityId: number;
  abilityId: string;
  providedTarget?: ProvidedTarget;
  enqueueTick: number;
}

/**
 * Per-world runtime state for the ability system.
 *
 * The {@link AbilitySystemRegistries} bundle holds *definitions* (attributes,
 * effects, abilities, hooks) which are immutable across the lifetime of a
 * world. Mutable per-world state — the monotonic instance-id counter for
 * {@link ActiveEffectInstance} and the FIFO activation request queue — lives
 * here so two parallel `GameWorld` instances cannot accidentally share state
 * and break determinism.
 */
export interface AbilitySystemRuntime {
  instanceIdCounter: InstanceIdCounter;
  /**
   * Pending activation requests in strict enqueue order. Drained by
   * {@link AbilityActivationSystem} on the tick after they were enqueued.
   * Mutated only by:
   *  - {@link AbilitySystemFacade.activateAbility} (push), and
   *  - {@link AbilityActivationSystem.processTick} (drain).
   */
  activationRequests: AbilityActivationRequest[];
  /**
   * Latest tick number observed by any ability system. Updated at the start
   * of {@link AbilityActivationSystem.processTick} and read by the facade so
   * `activateAbility` can record `enqueueTick` correctly. `-1` until the
   * first tick runs.
   */
  currentTick: number;
  /**
   * Activations that cleared `CanActivate` on the current tick and are
   * waiting for {@link AbilityHookExecutorSystem} to fire their hooks.
   * Populated by {@link AbilityActivationSystem}, drained (with `splice`)
   * by the executor. Must be empty at the start of every tick — the
   * activation system asserts this invariant.
   */
  resolvedActivationsThisTick: ResolvedAbilityActivationRecord[];
}

export function createAbilitySystemRuntime(): AbilitySystemRuntime {
  return {
    instanceIdCounter: new InstanceIdCounter(),
    activationRequests: [],
    currentTick: -1,
    resolvedActivationsThisTick: [],
  };
}
