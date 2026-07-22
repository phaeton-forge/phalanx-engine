import type { FixedPoint } from '@phalanx-engine/math';
import type { AttributeValue } from './AttributeValue';

/**
 * Minimal read-only slice of `AbilitySystemFacade` exposed to a
 * {@link MagnitudeCalculation}. Deliberately the same two methods every
 * game system already uses (`tryGetAttribute`, `hasTag`) — a calculation
 * reads exactly like any other piece of game code, no parallel reader type
 * to learn.
 *
 * The concrete `AbilitySystemFacade` satisfies this structurally (no
 * wrapper object is instantiated); the type only exists so calculations
 * cannot see mutating methods like `applyEffect` or `activateAbility` on
 * `ctx.abilities`, keeping the "must be pure" contract enforceable by the
 * compiler without re-entrancy risk.
 */
export interface AbilityStateReader {
  /** Non-throwing attribute read; `undefined` when the entity, its AttributesComponent, or the attribute id is missing. */
  tryGetAttribute(entityId: number, attrId: string): AttributeValue | undefined;
  hasTag(entityId: number, tag: string): boolean;
}

export interface MagnitudeCalcContext {
  /** Static magnitude declared on the modifier — the base value to transform. */
  baseMagnitude: FixedPoint;
  /**
   * Source entity that applied the effect, or `NO_SOURCE_ENTITY_ID` (`-1`)
   * when the effect was applied without one. A despawned source is
   * indistinguishable from a valid id here — use `abilities.tryGetAttribute`
   * (which returns `undefined` for both) rather than branching on the id.
   */
  sourceEntityId: number;
  /** Entity the effect is being applied to. */
  targetEntityId: number;
  /**
   * Read-only facade slice for looking up source/target attributes and
   * tags — the same object every game system already holds a reference to.
   */
  abilities: AbilityStateReader;
  /**
   * Per-application payload from `applyEffect` (SetByCaller analog); null if none.
   * Values are game-defined (`any`) for developer convenience; anything fed into FP math
   * must already be FP/int — determinism is the calculation author's responsibility.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- game-defined payload values, by design.
  setByCaller: ReadonlyMap<string, any> | null;
  effectId: string;
  attributeId: string;
}

/**
 * Unreal GAS `ModMagnitudeCalculation` analog: a pure, FP-only function that
 * transforms a modifier's static `baseMagnitude` into an effective magnitude
 * at effect-application time.
 *
 * MUST be pure and FP-only: no floats, no `Math.random`, no `Date`, no
 * external/mutable state. Calculations that throw propagate to the caller
 * (same loud-failure philosophy as an unknown effect id) — authors must
 * ensure calculations do not throw for valid game states (e.g. a missing
 * source attribute should read as `undefined` via `abilities.tryGetAttribute`,
 * not throw).
 */
export type MagnitudeCalculation = (ctx: MagnitudeCalcContext) => FixedPoint;
