import { GameSystem } from '@phalanx-engine/ecs';
import type { AbilitySystemRuntime } from '../runtime';

/**
 * Clears the per-world gameplay cue buffer at the end of the abilities
 * pipeline.
 *
 * Register this last whenever the gameplay cue buffer is used, including
 * headless/unit-test worlds that do not register {@link CueDispatchSystem}, so
 * cue events cannot leak across ticks.
 */
export class CueBufferCleanupSystem extends GameSystem {
  public constructor(private readonly runtime: AbilitySystemRuntime) {
    super();
  }

  public override processTick(_tick: number): void {
    this.runtime.gameplayCueBuffer.events.length = 0;
  }
}


