import { GameSystem } from 'phalanx-ecs';
import type { AbilitySystemRegistries } from '../registry';
import type { AbilitySystemRuntime } from '../runtime';
import type { AbilityActivationContext } from '../types';

/**
 * Runs activation hooks for abilities that resolved earlier in the current
 * tick.
 *
 * Per the design doc, hook execution is sandwiched between
 * `EffectApplicationSystem` (so the hook sees freshly-applied
 * cost/cooldown/selfEffects on the caster) and `EffectTickSystem` (so the
 * hook can observe Duration effect lifetimes that started this tick).
 * `AbilityActivationSystem` populates the `resolvedActivationsThisTick`
 * buffer; this system drains it.
 *
 * Hook implementation contract:
 *  - Hooks MUST be deterministic. They may spawn entities (projectiles,
 *    auras), enqueue commands into the physics package, or read attributes
 *    via `AbilitySystemFacade` — but they must not call `Date.now`,
 *    `Math.random`, or any floating-point math whose results are not
 *    reproducible across peers.
 *  - Hooks that need to apply additional effects should go through the
 *    facade's `applyEffect` — those effects land on the NEXT tick because
 *    the application system has already run for this tick. That latency is
 *    intentional and matches the published `applyEffect` contract.
 *  - Hooks throwing synchronously will propagate up through `processTick`.
 *    The buffer is cleared first so a partial drain does not leave the
 *    next-tick start in an invalid state.
 *
 * Unknown `hookId`s are surfaced loudly: they almost always mean the user
 * forgot to call `registerHook` for a known ability, which is the kind of
 * mistake that should fail at the first activation rather than ship as a
 * silent no-op.
 */
export class AbilityHookExecutorSystem extends GameSystem {
  public constructor(
    private readonly registries: AbilitySystemRegistries,
    private readonly runtime: AbilitySystemRuntime
  ) {
    super();
  }

  public override processTick(_tick: number): void {
    const buffer = this.runtime.resolvedActivationsThisTick;
    if (buffer.length === 0) {
      return;
    }

    // Snapshot then clear before iterating so:
    //  - a hook that throws cannot leave entries behind for next tick (and
    //    therefore cannot trigger the start-of-tick assertion in
    //    AbilityActivationSystem);
    //  - a hook that re-enters the activation path via the facade enqueues
    //    requests for the NEXT tick (the runtime queue is separate from our
    //    snapshot here), preserving determinism.
    const drained = buffer.splice(0, buffer.length);

    for (let i = 0; i < drained.length; i++) {
      const resolved = drained[i];
      if (resolved.hookId === undefined) {
        continue;
      }
      const hook = this.registries.hooks.tryGet(resolved.hookId);
      if (!hook) {
        throw new Error(`AbilityHooksRegistry does not contain '${resolved.hookId}'`);
      }
      const ctx: AbilityActivationContext = {
        abilityId: resolved.abilityId,
        casterEntityId: resolved.casterEntityId,
        resolvedTargets: resolved.resolvedTargets,
        providedTarget: resolved.providedTarget,
        tick: resolved.tick,
      };
      hook(ctx);
    }
  }
}
