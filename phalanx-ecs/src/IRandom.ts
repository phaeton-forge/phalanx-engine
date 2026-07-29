/**
 * Match-scoped deterministic random number generator.
 *
 * Implemented by {@link DeterministicRandom} from `@phalanx-engine/client`
 * and wired into {@link SystemContext} by {@link GameWorld} or the tick
 * provider (e.g. {@link PhalanxClient}).
 */
export interface IRandom {
  float(): number;
  floatRange(min: number, max: number): number;
  int(max: number): number;
  intRange(min: number, max: number): number;
  boolean(probability?: number): boolean;
  pick<T>(array: readonly T[]): T;
  shuffle<T>(array: T[]): T[];
}
