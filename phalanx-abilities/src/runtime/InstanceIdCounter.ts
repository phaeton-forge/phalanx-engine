/**
 * Monotonically-increasing counter for {@link ActiveEffectInstance.instanceId}.
 *
 * Determinism contract:
 *  - Each world owns one counter. All effect applications go through the
 *    facade so the ordering of `next()` calls is fully determined by the
 *    sequence of `applyEffect`/`pendingAdd` drains within a tick.
 *  - Values are strictly increasing and never reused, so FIFO aggregation
 *    in `AttributeAggregationSystem` matches insertion order regardless of
 *    how `ActiveEffectsComponent.queue` is rearranged later.
 */
export class InstanceIdCounter {
  private value = 0;

  public next(): number {
    this.value += 1;
    return this.value;
  }

  /** Current high-water mark; useful for snapshot/golden-hash tests. */
  public get current(): number {
    return this.value;
  }
}
