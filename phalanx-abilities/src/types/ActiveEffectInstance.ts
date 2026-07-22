import type { FixedPoint } from '@phalanx-engine/math';

export interface ActiveEffectInstance {
  /** Monotonic id used for deterministic FIFO modifier aggregation. */
  instanceId: number;
  defId: string;
  remainingTicks: number;
  /**
   * Only meaningful for Periodic effects. Holds the next absolute simulation
   * tick at which the effect's modifiers must fire (Instant-style writes to
   * `AttributesComponent.base`). When `currentTick >= nextPeriodTick` and the
   * instance was not just inserted on the same tick, EffectTickSystem applies
   * the modifiers and advances `nextPeriodTick` by `EffectDef.periodTicks`.
   * For Duration instances the field is left at `0` and ignored.
   */
  nextPeriodTick: number;
  /**
   * Source entity that applied the effect, or `-1` for no source (e.g. world
   * hazards, debug spawns). Effects authored by the facade's
   * {@link AbilitySystemFacade.applyEffect} default to `-1` when the caller
   * omits a source.
   */
  sourceEntityId: number;
  /**
   * Tick at which this instance was inserted into the queue by
   * {@link EffectApplicationSystem}. Used by {@link EffectTickSystem} to skip
   * the very first countdown so a freshly-applied effect with `durationTicks=1`
   * survives through {@link AttributeAggregationSystem} on its application tick.
   */
  enteredOnTick: number;
  /**
   * Per-modifier effective magnitudes, snapshotted once at application time
   * (parallel array to `EffectDef.modifiers`, same index). `undefined`/`null`
   * when none of the effect's modifiers declare a `calculation` — the
   * pre-existing, zero-overhead path (also the shape produced by
   * hand-authored instances, e.g. in tests, that omit this field). When
   * present, `AttributeAggregationSystem` and `EffectTickSystem` read
   * `capturedMagnitudes[i]` in place of `modifiers[i].magnitude` for every
   * modifier so a Duration/Periodic effect's magnitude stays fixed for its
   * whole lifetime even if the source entity's attributes change or the
   * source despawns after application.
   */
  capturedMagnitudes?: FixedPoint[] | null;
}
