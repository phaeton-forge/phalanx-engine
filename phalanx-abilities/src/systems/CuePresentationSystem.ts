import { GameSystem } from '@phalanx-engine/ecs';
import type { IAfterFrame, SystemContext } from '@phalanx-engine/ecs';
import { gameplayCueKey } from '../events';
import type { GameplayCueDispatchedEvent } from '../events';
import type { Cue, CueConfig, CueContext } from '../cues';

/**
 * Spawns one short-lived {@link Cue} instance per dispatched cue event and drives
 * its per-frame update via the GameWorld afterFrame hook, disposing it once it
 * reports completion.
 *
 * Registered as part of abilities.tickSystems (auto-appended by SystemRegistry)
 * but performs NO tick work — presentation runs only in afterFrame.
 */
export class CuePresentationSystem extends GameSystem implements IAfterFrame {
  private cueContext!: CueContext;
  private activeCues: Cue[] = [];

  public constructor(private readonly cues: CueConfig) {
    super();
  }

  public override init(context: SystemContext): void {
    super.init(context);

    this.cueContext = {
      entityManager: context.entityManager,
      eventBus: context.eventBus,
    };

    for (const [cueId, factory] of Object.entries(this.cues)) {
      this.subscribe<GameplayCueDispatchedEvent>(gameplayCueKey(cueId), (event) => {
        const cue = factory();
        cue.onSpawn(event, this.cueContext);
        if (cue.isFinished()) {
          cue.dispose();
        } else {
          this.activeCues.push(cue);
        }
      });
    }
  }

  /** No tick work: presentation is afterFrame-only. */
  public override processTick(_tick: number): void {}

  public afterFrame(_alpha: number, deltaTimeSeconds: number): void {
    const cues = this.activeCues;
    for (let i = cues.length - 1; i >= 0; i--) {
      const cue = cues[i];
      cue.update(deltaTimeSeconds);
      if (cue.isFinished()) {
        cue.dispose();
        cues[i] = cues[cues.length - 1];
        cues.pop();
      }
    }
  }

  public override dispose(): void {
    for (const cue of this.activeCues) {
      cue.dispose();
    }
    this.activeCues = [];
    super.dispose();
  }
}
