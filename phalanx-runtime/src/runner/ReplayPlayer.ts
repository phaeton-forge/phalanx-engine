import type { Unsubscribe } from '@phalanx-engine/ecs';
import type { AnyGameDefinition, ConfigOf } from '../game/GameDefinition.js';
import type { Digest } from '../state/snapshot.js';
import { MatchRunner, type RunnerOptions } from './MatchRunner.js';
import type { ReplayRecord } from './replay.js';

/**
 * Read-only playback of a {@link ReplayRecord}. Hosted policies do not
 * `decide`. `start` and `submit` are not available: a replay has no live
 * clock and accepts no new commands.
 */
export class ReplayPlayer<G extends AnyGameDefinition> {
  private constructor(
    private readonly runner: MatchRunner<G>,
    private readonly replay: ReplayRecord<ConfigOf<G>>
  ) {}

  public static from<GDef extends AnyGameDefinition>(
    definition: GDef,
    replay: ReplayRecord<ConfigOf<GDef>>,
    options?: RunnerOptions
  ): ReplayPlayer<GDef> {
    return new ReplayPlayer(
      MatchRunner.openReplay(definition, replay, options),
      replay
    );
  }

  /** Last completed tick, `-1` before the first tick. */
  public get tick(): number {
    return this.runner.tick;
  }

  public digest(): Digest {
    return this.runner.digest();
  }

  public onTick(handler: (tick: number) => void): Unsubscribe {
    return this.runner.onTick(handler);
  }

  /** Play through `replay.lastTick`, yielding every `budgetMs`. */
  public play(options: { readonly budgetMs: number }): Promise<void> {
    return this.runner.fastForward(this.replay.log, {
      budgetMs: options.budgetMs,
      throughTick: this.replay.lastTick,
    });
  }

  /** Play through `throughTick` in one chunk. */
  public fastForward(throughTick: number): Promise<void> {
    return this.runner.fastForward(this.replay.log, {
      budgetMs: Number.POSITIVE_INFINITY,
      throughTick,
    });
  }
}
