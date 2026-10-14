/**
 * Match-scoped deterministic random number generator.
 *
 * Implemented by {@link DeterministicRandom} from `@phalanx-engine/client`
 * and wired into {@link SystemContext} by {@link GameWorld} or the tick
 * provider (e.g. {@link PhalanxClient}).
 */
export interface IRandom {
  /**
   * @deprecated No floats in simulation code. Use {@link int} or
   * {@link intRange}. Removed once remaining call sites are gone
   * (docs/design/runtime-api.md, Decisions).
   */
  float(): number;
  /**
   * @deprecated No floats in simulation code. Use {@link intRange}.
   * Removed once remaining call sites are gone.
   */
  floatRange(min: number, max: number): number;
  int(max: number): number;
  intRange(min: number, max: number): number;
  /**
   * @deprecated A float probability draw. Simulation code uses an integer
   * threshold instead. Removed with {@link float}.
   */
  boolean(probability?: number): boolean;
  pick<T>(array: readonly T[]): T;
  shuffle<T>(array: T[]): T[];
}
