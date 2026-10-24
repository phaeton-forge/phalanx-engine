import { afterEach, describe, expect, it } from 'vitest';
import { Entity, GameWorld } from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import {
  defineComponent,
  restoreWorld,
  saveWorld,
  spawn,
} from '../../src/index.js';
import { manualTickProvider } from '../support/manualTickProvider.js';

function open(): GameWorld {
  return new GameWorld({
    tickFrameProvider: manualTickProvider(),
    random: new DeterministicRandom(4),
  });
}

describe('per-world entity ids', () => {
  const live: GameWorld[] = [];

  afterEach(() => {
    while (live.length > 0) live.pop()?.dispose();
  });

  it('keeps each world on its own ids when two worlds are interleaved', () => {
    const unit = defineComponent('Unit', { x: 'i32' });
    const make = (): GameWorld => {
      const world = open();
      world.registerComponent(unit);
      live.push(world);
      return world;
    };

    const solo = make();
    spawn(solo, { Unit: { x: 1 } });
    spawn(solo, { Unit: { x: 2 } });
    const soloBytes = saveWorld(solo);

    const a = make();
    const first = spawn(a, { Unit: { x: 1 } });
    const b = make();
    const other = spawn(b, { Unit: { x: 9 } });
    expect(first.id).toBe(1);
    expect(other.id).toBe(1);
    b.dispose();
    live.splice(live.indexOf(b), 1);
    // SoA lookup is still process-global. Ids are not.
    const second = spawn(a, { Unit: { x: 2 } });
    expect(second.id).toBe(2);
    expect(saveWorld(a)).toEqual(soloBytes);
  });

  it('restores the same ids and the same next id through createEntityWithId', () => {
    const source = open();
    live.push(source);
    const high = source.createEntityWithId(5, (id) => new Entity(id));
    const hole = source.createEntityWithId(2, (id) => new Entity(id));
    expect(high.id).toBe(5);
    expect(hole.id).toBe(2);
    expect(source.entityManager.entityIdHighWater()).toBe(5);

    const bytes = saveWorld(source);
    const restored = open();
    live.push(restored);
    restoreWorld(restored, bytes);

    expect(restored.entityManager.getEntity(5)?.id).toBe(5);
    expect(restored.entityManager.getEntity(2)?.id).toBe(2);
    expect(restored.entityManager.entityIdHighWater()).toBe(5);
    expect(restored.createEntity((id) => new Entity(id)).id).toBe(6);
  });
});
