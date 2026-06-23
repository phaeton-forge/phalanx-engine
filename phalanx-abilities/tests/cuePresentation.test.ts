import { describe, expect, it, vi } from 'vitest';
import { FP } from '@phalanx-engine/math';
import type { GameWorld } from '@phalanx-engine/ecs';
import {
  Cue,
  CuePresentationSystem,
  defineEffect,
  type CueConfig,
  type CueContext,
  type GameplayCueDispatchedEvent,
} from '../src';
import { GAMEPLAY_CUE_EVENT } from '../src/events';
import {
  ArmorAttribute,
  DISPATCH_CUES,
  HealthAttribute,
  NoopCue,
  createTestWorld,
  spawnEntity,
} from './helpers';

const PRESENTATION_CUE_ID = 'Cue.Test.Presentation';

class TestCue extends Cue {
  public onSpawnCalls = 0;
  public updates = 0;
  public disposed = false;
  public lastEvent: GameplayCueDispatchedEvent | undefined;
  public lastContext: CueContext | undefined;

  public constructor(private framesToLive: number) {
    super();
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    this.onSpawnCalls++;
    this.lastEvent = event;
    this.lastContext = context;
  }

  public override update(_deltaTimeSeconds: number): void {
    this.updates++;
    this.framesToLive--;
  }

  public override isFinished(): boolean {
    return this.framesToLive <= 0;
  }

  public override dispose(): void {
    this.disposed = true;
  }
}

function runPresentationFrame(world: GameWorld, deltaTimeSeconds = 1 / 60): void {
  world.getSystem(CuePresentationSystem)?.afterFrame(0, deltaTimeSeconds);
}

function createPresentationTestWorld(
  cues: CueConfig,
  cueId: string = PRESENTATION_CUE_ID
) {
  return createTestWorld({
    pipeline: 'effects',
    attributes: [HealthAttribute, ArmorAttribute],
    cues,
    effects: [
      defineEffect({
        id: 'Effect.TestCue',
        type: 'Instant',
        cues: [cueId],
      }),
    ],
  });
}

function dispatchTestCue(
  world: GameWorld,
  abilities: ReturnType<typeof createPresentationTestWorld>['abilities']
): { sourceId: number; targetId: number } {
  const source = spawnEntity(world, abilities);
  const target = spawnEntity(world, abilities);
  world.processAllTicks(1);
  abilities.applyEffect(target.id, 'Effect.TestCue', source.id);
  world.processAllTicks(2);
  return { sourceId: source.id, targetId: target.id };
}

describe('CuePresentationSystem', () => {
  it('invokes the factory once per dispatch and keeps each live cue active', () => {
    const spawned: TestCue[] = [];
    const factory = vi.fn(() => {
      const cue = new TestCue(5);
      spawned.push(cue);
      return cue;
    });
    const { world, abilities } = createPresentationTestWorld({
      [PRESENTATION_CUE_ID]: factory,
    });

    dispatchTestCue(world, abilities);
    dispatchTestCue(world, abilities);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(spawned).toHaveLength(2);
    expect(spawned.every((cue) => cue.onSpawnCalls === 1 && !cue.disposed)).toBe(true);
    world.dispose();
  });

  it('calls onSpawn with the dispatch event and a functional CueContext', () => {
    const cue = new TestCue(3);
    const { world, abilities } = createPresentationTestWorld({
      [PRESENTATION_CUE_ID]: () => cue,
    });
    const { sourceId, targetId } = dispatchTestCue(world, abilities);

    expect(cue.onSpawnCalls).toBe(1);
    expect(cue.lastEvent).toEqual({
      tick: 2,
      cueId: PRESENTATION_CUE_ID,
      sourceEntityId: sourceId,
      targetEntityId: targetId,
      phase: 'OnApplied',
    });

    const contextEvents: string[] = [];
    cue.lastContext!.eventBus.on('Cue.Context.Test', () => contextEvents.push('ok'));
    cue.lastContext!.eventBus.emit('Cue.Context.Test', {});
    expect(contextEvents).toEqual(['ok']);
    expect(cue.lastContext!.entityManager.getEntity(targetId)).toBeDefined();

    world.dispose();
  });

  it('drives update(dt) on live cues during afterFrame', () => {
    const cue = new TestCue(3);
    const { world, abilities } = createPresentationTestWorld({
      [PRESENTATION_CUE_ID]: () => cue,
    });
    dispatchTestCue(world, abilities);

    runPresentationFrame(world, 0.016);
    runPresentationFrame(world, 0.016);

    expect(cue.updates).toBe(2);
    world.dispose();
  });

  it('disposes and removes finished cues so they receive no further updates', () => {
    const cue = new TestCue(1);
    const { world, abilities } = createPresentationTestWorld({
      [PRESENTATION_CUE_ID]: () => cue,
    });
    dispatchTestCue(world, abilities);

    runPresentationFrame(world, 0.016);
    expect(cue.disposed).toBe(true);
    expect(cue.updates).toBe(1);

    runPresentationFrame(world, 0.016);
    expect(cue.updates).toBe(1);
    world.dispose();
  });

  it('disposes instant cues once without entering the active list or updating', () => {
    const dispose = vi.fn();
    class TrackedNoopCue extends NoopCue {
      public override dispose(): void {
        dispose();
      }
    }

    const factory = vi.fn(() => new TrackedNoopCue());
    const { world, abilities } = createPresentationTestWorld({
      [PRESENTATION_CUE_ID]: factory,
    });
    dispatchTestCue(world, abilities);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);

    runPresentationFrame(world, 0.016);
    expect(dispose).toHaveBeenCalledTimes(1);
    world.dispose();
  });

  it('still emits GAMEPLAY_CUE_EVENT when cues are registered', () => {
    const { world, abilities, cueLog } = createTestWorld({
      pipeline: 'effects',
      attributes: [HealthAttribute, ArmorAttribute],
      cues: DISPATCH_CUES,
      effects: [
        defineEffect({
          id: 'Effect.Signal',
          type: 'Instant',
          cues: ['Cue.Signal'],
        }),
      ],
    });
    const source = spawnEntity(world, abilities);
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(target.id, 'Effect.Signal', source.id);
    world.processAllTicks(2);

    expect(cueLog).toEqual([
      {
        tick: 2,
        cueId: 'Cue.Signal',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnApplied',
      },
    ]);
    world.dispose();
  });

  it('disposes all live cues when the world is disposed', () => {
    const cue = new TestCue(100);
    const { world, abilities } = createPresentationTestWorld({
      [PRESENTATION_CUE_ID]: () => cue,
    });
    dispatchTestCue(world, abilities);

    expect(cue.disposed).toBe(false);
    world.dispose();
    expect(cue.disposed).toBe(true);
  });

  it('retains the cue buffer under effects-retain-cues', () => {
    const { world, abilities } = createTestWorld({
      pipeline: 'effects-retain-cues',
      attributes: [HealthAttribute, ArmorAttribute],
      effects: [
        defineEffect({
          id: 'Effect.Retained',
          type: 'Instant',
          modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-1) }],
          cues: ['Cue.Retained'],
        }),
      ],
    });
    const source = spawnEntity(world, abilities);
    const target = spawnEntity(world, abilities);
    world.processAllTicks(1);

    abilities.applyEffect(target.id, 'Effect.Retained', source.id);
    world.processAllTicks(2);

    expect(abilities.gameplayCueBuffer.events).toEqual([
      {
        tick: 2,
        cueId: 'Cue.Retained',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnApplied',
      },
    ]);

    world.processAllTicks(3);
    expect(abilities.gameplayCueBuffer.events).toEqual([
      {
        tick: 2,
        cueId: 'Cue.Retained',
        sourceEntityId: source.id,
        targetEntityId: target.id,
        phase: 'OnApplied',
      },
    ]);
    world.dispose();
  });
});
