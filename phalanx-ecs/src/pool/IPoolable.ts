/**
 * Contract for objects that support reuse via an object pool.
 * Entity and Component classes implement this interface to enable pooling.
 */
export interface IPoolable {
  /**
   * Reset the object to a clean initial state.
   * Called when returning the object to the pool and before handing it out.
   * Must NOT allocate new objects — only reuse existing fields.
   */
  reset(): void;
}
