export interface ActiveEffectInstance {
  /** Monotonic id used for deterministic FIFO modifier aggregation. */
  instanceId: number;
  defId: string;
  remainingTicks: number;
  /** Only meaningful for Periodic effects. */
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
}
