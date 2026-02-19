import { ComponentType, type IComponent } from './Component';
import { networkConfig } from '../config/constants';

/**
 * DeathComponent - Deterministic death timing for entities
 *
 * IMPORTANT FOR DETERMINISM:
 * Instead of relying on animation callbacks (which are frame-rate dependent),
 * this component tracks death via tick count. All clients will destroy
 * entities at exactly the same simulation tick.
 *
 * The animation plays purely for visual effect, but the actual entity
 * destruction is controlled by the tick-based timer.
 */
export class DeathComponent implements IComponent {
  public readonly type = ComponentType.Death;

  /** Whether the entity is currently dying */
  public isDying: boolean = false;

  /** Tick when death started */
  public deathStartTick: number = 0;

  /** Number of ticks until entity is destroyed (deterministic) */
  public deathDurationTicks: number;

  /** Callback to invoke when death completes */
  public onDeathComplete: (() => void) | null = null;

  /**
   * Create a new DeathComponent
   * @param deathDurationSeconds Duration of death animation in seconds (default: 1.5)
   */
  constructor(deathDurationSeconds: number = 1.5) {
    // Convert seconds to ticks for deterministic timing
    this.deathDurationTicks = Math.ceil(deathDurationSeconds * networkConfig.tickRate);
  }

  /**
   * Start the death sequence
   * @param currentTick The current simulation tick
   * @param onComplete Callback when death completes
   */
  public startDeath(currentTick: number, onComplete: () => void): void {
    if (this.isDying) return;

    this.isDying = true;
    this.deathStartTick = currentTick;
    this.onDeathComplete = onComplete;
  }

  /**
   * Check if death should complete on this tick
   * @param currentTick The current simulation tick
   * @returns true if death timer has expired
   */
  public shouldCompleteThisTick(currentTick: number): boolean {
    if (!this.isDying) return false;
    return (currentTick - this.deathStartTick) >= this.deathDurationTicks;
  }

  /**
   * Complete the death - invoke callback and reset state
   */
  public completeDeath(): void {
    if (this.onDeathComplete) {
      this.onDeathComplete();
      this.onDeathComplete = null;
    }
    this.isDying = false;
  }

  /**
   * Get remaining ticks until death completes
   */
  public getRemainingTicks(currentTick: number): number {
    if (!this.isDying) return 0;
    return Math.max(0, this.deathDurationTicks - (currentTick - this.deathStartTick));
  }
}

