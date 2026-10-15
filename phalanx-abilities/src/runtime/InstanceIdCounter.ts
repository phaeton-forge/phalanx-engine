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

  /**
   * Restore the high-water mark. Any integer `>= 0` is accepted, including
   * a value below the current mark, so a snapshot can move the counter
   * backwards. The next {@link next} call returns `value + 1`.
   *
   * The caller must pass a value greater than or equal to every live
   * effect instance id. A lower integer is stored, and the next allocation
   * can then collide with an id that is still in use. That bound is the
   * caller's responsibility.
   *
   * @throws If `value` is not a safe integer `>= 0`.
   */
  public set(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(
        `InstanceIdCounter.set: value must be an integer >= 0, got ${String(value)}`
      );
    }
    this.value = value;
  }
}
