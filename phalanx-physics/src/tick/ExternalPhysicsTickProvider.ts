import type { IPhysicsTickProvider } from './IPhysicsTickProvider';

export class ExternalPhysicsTickProvider implements IPhysicsTickProvider {
  private onStepFn: (() => void) | null = null;
  start(onStep: () => void): void { this.onStepFn = onStep; }
  stop(): void { this.onStepFn = null; }
  /** Call from your game loop (e.g. BabylonJS onBeforeRenderObservable) */
  tick(): void { this.onStepFn?.(); }
}
