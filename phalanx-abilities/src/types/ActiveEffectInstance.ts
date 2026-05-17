export interface ActiveEffectInstance {
  /** Monotonic id used for deterministic FIFO modifier aggregation. */
  instanceId: number;
  defId: string;
  remainingTicks: number;
  /** Only meaningful for Periodic effects. */
  nextPeriodTick: number;
  sourceEntityId: number;
}
