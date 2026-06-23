import type { EntityManager, EventBus } from '@phalanx-engine/ecs';
import type { GameplayCueDispatchedEvent } from '../events';

/**
 * Narrow, read-only projection of the engine's SystemContext handed to a Cue.
 * Cues are presentation-only and must never reach into mutable engine internals
 * (system registry, abilities/physics mutation).
 *
 * Presentation-specific deps (scene, renderer, audio) are injected via the Cue
 * subclass constructor (captured by the factory closure), so phalanx-abilities
 * stays free of rendering deps.
 */
export interface CueContext {
  readonly entityManager: EntityManager;
  readonly eventBus: EventBus;
}

/**
 * Short-lived, self-managing presentation effect. ONE instance per dispatched
 * cue event. Presentation-only: never mutate deterministic simulation state.
 *
 * Lifecycle (driven by CuePresentationSystem):
 *  - constructor(deps)     presentation deps (scene/audio) via closure in the factory.
 *  - onSpawn(event, ctx)   bind to world: read entities, compute impact, build VFX.
 *  - update(dt)            per render frame; animate; flag completion.
 *  - isFinished()          true once fully played → engine disposes + removes it.
 *  - dispose()             remove VFX / free resources.
 */
export abstract class Cue {
  /** Bind the freshly created cue to the dispatch event + world services. */
  public abstract onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void;

  /** Per-frame animation. Default: no-op. */
  public update(_deltaTimeSeconds: number): void {}

  /** True once the effect has fully played. Default: never finishes (override!). */
  public isFinished(): boolean {
    return false;
  }

  /** Remove VFX / free resources. Default: no-op. */
  public dispose(): void {}
}

/** Per-dispatch factory. Presentation deps captured via closure (no DI). */
export type CueFactory = () => Cue;

/** Public cue configuration: cue id → factory. */
export type CueConfig = Readonly<Record<string, CueFactory>>;
