import type { IPhysicsTickProvider } from './IPhysicsTickProvider';

export interface AutonomousProviderOptions {
  /** Max simulation steps before forcing a stop (prevents infinite loops). Default: 10000 */
  maxSteps?: number;
  /** Called every step to check if simulation should stop. Defined by the game. */
  isSettled: () => boolean;
  /** Called once when the simulation settles or maxSteps is reached. Defined by the game. */
  onSettled: () => void;
}

export class AutonomousPhysicsTickProvider implements IPhysicsTickProvider {
  private running = false;
  private steps = 0;
  private onStepFn: (() => void) | null = null;
  private readonly options: Required<AutonomousProviderOptions>;

  constructor(options: AutonomousProviderOptions) {
    this.options = { maxSteps: 10_000, ...options };
  }

  start(onStep: () => void): void {
    this.running = true;
    this.steps = 0;
    this.onStepFn = onStep;
    this.schedule();
  }

  stop(): void { this.running = false; }

  private schedule(): void {
    const next = typeof setImmediate !== 'undefined'
      ? (fn: () => void) => setImmediate(fn)
      : (fn: () => void) => queueMicrotask(fn);
    next(() => this.tick());
  }

  private tick(): void {
    if (!this.running) return;
    this.onStepFn!();
    this.steps++;
    if (this.options.isSettled() || this.steps >= this.options.maxSteps) {
      this.running = false;
      this.options.onSettled();
      return;
    }
    this.schedule();
  }
}
