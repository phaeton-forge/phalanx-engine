import type { ProvidedTarget } from '../types';

/**
 * Emitted on the world `EventBus` by {@link AbilityActivationSystem} after an
 * activation request has cleared `CanActivate` and the caster-side effects
 * (cost, cooldown, `selfEffectIds`) have been queued for application.
 *
 * The event fires from a deterministic point in the tick: after activation
 * has been accepted and caster-side effects have been queued, but before
 * Stage 6 target resolution populates `resolvedTargets`. Subscribers may use
 * it to drive deterministic game logic — for example, a projectile-spawn
 * system that runs later in the same tick, after the abilities pipeline.
 *
 * Determinism notes:
 *  - `resolvedTargets` may already contain resolved entity IDs in Stage 5 for
 *    target kinds handled by {@link AbilityActivationSystem}, including
 *    `Self` and direct `Entity` targets. Later stages such as Stage 6's
 *    `TargetResolutionSystem` may still resolve additional target kinds
 *    without changing the event shape.
 *  - Non-deterministic side effects (audio, Date.now, Math.random) MUST NOT
 *    be triggered from synchronous subscribers running inside the tick.
 *    Visual cues belong on the cue queue, dispatched only by clients.
 */
export interface AbilityActivatedEvent {
  abilityId: string;
  casterEntityId: number;
  resolvedTargets: readonly number[];
  providedTarget?: ProvidedTarget;
  tick: number;
}

/**
 * Event-bus key for {@link AbilityActivatedEvent}. Namespaced under the
 * package so consumers won't collide with unrelated subsystems.
 */
export const ABILITY_ACTIVATED_EVENT = 'phalanx-abilities:AbilityActivated';
