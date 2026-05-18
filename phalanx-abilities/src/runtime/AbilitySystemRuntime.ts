import { InstanceIdCounter } from './InstanceIdCounter';

/**
 * Per-world runtime state for the ability system.
 *
 * The {@link AbilitySystemRegistries} bundle holds *definitions* (attributes,
 * effects, abilities, hooks) which are immutable across the lifetime of a
 * world. Mutable per-world state — currently just the monotonic instance-id
 * counter for {@link ActiveEffectInstance} — lives here so two parallel
 * `GameWorld` instances cannot accidentally share counters and break
 * determinism.
 */
export interface AbilitySystemRuntime {
  instanceIdCounter: InstanceIdCounter;
}

export function createAbilitySystemRuntime(): AbilitySystemRuntime {
  return {
    instanceIdCounter: new InstanceIdCounter(),
  };
}
