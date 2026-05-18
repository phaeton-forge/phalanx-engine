import type { ProvidedTarget } from '../types';

/**
 * Emitted on the world `EventBus` by {@link AbilityActivationSystem} after an
 * activation request has cleared `CanActivate` and the caster-side effects
 * (cost, cooldown, `selfEffectIds`) have been queued for application.
 *
 * The event fires from a deterministic point in the tick (see system order in
 * the package README), so subscribers may use it to drive deterministic game
 * logic — for example, a projectile-spawn system that also runs as a
 * `processTick` callback ordered after the abilities pipeline.
 *
 * Determinism notes:
 *  - `resolvedTargets` is empty in Stage 5: target resolution is the job of
 *    Stage 6's `TargetResolutionSystem`. It is included in the payload so
 *    later stages can populate it without changing the event shape.
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
