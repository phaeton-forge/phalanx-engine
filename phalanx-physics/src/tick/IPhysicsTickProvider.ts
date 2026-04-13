/**
 * Controls when the physics simulation advances.
 * Implement this interface to plug any scheduling strategy into PhysicsWorld.
 */
export interface IPhysicsTickProvider {
  /**
   * Start the provider. It will call `onStep()` whenever the simulation
   * should advance by one fixed sub-step batch.
   */
  start(onStep: () => void): void;

  /** Stop the provider and release any timers / handles. */
  stop(): void;
}
