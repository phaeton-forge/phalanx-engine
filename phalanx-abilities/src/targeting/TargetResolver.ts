import type { ProvidedTarget, TargetOrigin, TargetSpec } from '../types';

/**
 * Input to {@link TargetResolver.resolve}. Keeps the resolver self-contained
 * — every input it needs is on this record, not on a system field.
 */
export interface TargetResolutionInput {
  /**
   * The entity casting the ability. Used to resolve `TargetOrigin.kind ===
   * 'Caster'`, and as the `selfId` default for some resolved targets.
   */
  casterEntityId: number;
  spec: TargetSpec;
  /**
   * Caller-supplied target for `TargetOrigin.kind === 'Caller'`. May supply
   * `entityId` (for `Entity` shapes) or `x`/`z` (for `Point`
   * origins). When the origin kind is `Caller` and the required field is
   * missing, {@link TargetResolver.resolve} returns a `{ dropped: true }`
   * result so the caller can abort the activation cleanly.
   */
  providedTarget?: ProvidedTarget;
}

/**
 * Result of {@link TargetResolver.resolve}. The discriminated `dropped`
 * flag distinguishes between:
 *   - `{ dropped: false, targets: [...] }`: resolution succeeded. `targets`
 *     is the deterministic, possibly-empty list of affected entity ids.
 *     An empty list is a legitimate outcome (e.g. a `Point` target shape)
 *     and the activation should proceed: caster-side effects, event
 *     emission, hook scheduling.
 *   - `{ dropped: true }`: the caller forgot to supply required input
 *     (e.g. `TargetOrigin.kind === 'Caller'` on a Point without a
 *     point). The activation must NOT enqueue cost / cooldown / self
 *     effects, must NOT emit `AbilityActivated`, and must NOT schedule
 *     hooks. This matches the documented contract that "the verdict is
 *     observed via side effects, not via `activateAbility`'s return
 *     value".
 */
export type TargetResolutionResult =
  | { dropped: false; targets: number[] }
  | { dropped: true };

/**
 * Pure resolver for {@link TargetSpec}. Owns the entire mapping from a
 * declarative spec + caller input to the deterministic ordered list of
 * affected entity ids.
 *
 * Determinism rules enforced here:
 *   1. The result is always sorted by `entityId` ASC.
 *   2. The resolver is stateless — it never reads "the current tick" or
 *      mutates registries — so two invocations with identical inputs are
 *      byte-for-byte identical regardless of when they run.
 *
 * Used from two call sites:
 *   - {@link AbilityActivationSystem} during ability activation, where the
 *     spec comes from `AbilityDef.target` and the caller is the user that
 *     invoked `activateAbility`.
 */
export class TargetResolver {
  public constructor() {}

  /**
   * Sentinel value for the "drop activation" outcome. Reused across calls
   * so the system path can compare by reference.
   */
  private static readonly DROPPED: TargetResolutionResult = { dropped: true };

  public resolve(input: TargetResolutionInput): TargetResolutionResult {
    const { spec } = input;
    switch (spec.kind) {
      case 'Self':
        return { dropped: false, targets: [input.casterEntityId] };
      case 'Entity': {
        const resolved = this.resolveEntityOrigin(
          input.casterEntityId,
          spec.origin,
          input.providedTarget
        );
        if (resolved.dropped) {
          return TargetResolver.DROPPED;
        }
        if (resolved.entityId === undefined) {
          // Legitimate "no target" — e.g. TargetEntity origin pointing
          // at an id that's no longer present. We continue the
          // activation: the caster pays the cost, the hook fires with
          // an empty target list.
          return { dropped: false, targets: [] };
        }
        return { dropped: false, targets: [resolved.entityId] };
      }
      case 'Point': {
        // A Point target intentionally resolves to zero entities. The point
        // itself is consumed by ability hooks via providedTarget (or by
        // user code reading AbilityActivationContext). `targetEffectIds`
        // on a Point-targeted ability is therefore a no-op.
        //
        // However, when the origin is `Caller` the caller MUST supply a
        // point — otherwise the hook has no impact location and the
        // activation should drop. Other origins (Point, Caster,
        // TargetEntity) carry the point inside the spec itself.
        if (spec.origin.kind === 'Caller') {
          const provided = input.providedTarget;
          if (!provided || provided.x === undefined || provided.z === undefined) {
            return TargetResolver.DROPPED;
          }
        }
        return { dropped: false, targets: [] };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Origin resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve an `Entity`-shape origin to a single target entity id, or a
   * drop signal if the caller forgot to supply required input.
   *
   * `entityId: undefined` (with `dropped: false`) is a legitimate "target
   * resolved but to nothing" outcome — currently unreachable here, but
   * preserved so the call site can distinguish the empty case from the
   * drop case in future origin kinds.
   */
  private resolveEntityOrigin(
    casterId: number,
    origin: TargetOrigin,
    providedTarget: ProvidedTarget | undefined
  ): { dropped: false; entityId: number | undefined } | { dropped: true } {
    switch (origin.kind) {
      case 'Caster':
        return { dropped: false, entityId: casterId };
      case 'TargetEntity':
        return { dropped: false, entityId: origin.entityId };
      case 'Caller':
        if (providedTarget?.entityId === undefined) {
          // Caller forgot to supply a target entity — drop the activation.
          return { dropped: true };
        }
        return { dropped: false, entityId: providedTarget.entityId };
      case 'Point':
        // `Point` origin is meaningful only for `Point` target
        // shapes; using it as an `Entity` origin is a programming
        // error, not a runtime miss.
        throw new Error(
          "TargetOrigin.kind === 'Point' is not valid for TargetSpec.kind === 'Entity'."
        );
    }
  }

  // ---------------------------------------------------------------------------
}

