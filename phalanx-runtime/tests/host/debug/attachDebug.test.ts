import { afterEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import {
  Entity,
  GameWorld,
  GameWorldEvents,
  type IComponent,
  type ITickFrameProvider,
} from '@phalanx-engine/ecs';
import { attachDebug } from '../../../src/host/debug/attachDebug.js';
import type { DebugSnapshot } from '../../../src/host/debug/types.js';
import { manualTickProvider } from '../../support/manualTickProvider.js';

const HealthType = Symbol('Health');

class HealthComponent implements IComponent {
  readonly type = HealthType;
  constructor(public hp: number = 100) {}
}

function bareProvider(): ITickFrameProvider {
  return {
    onTick: () => () => {},
    onFrame: () => () => {},
  };
}

describe('attachDebug', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('pushes snapshots on updateInterval', () => {
    vi.useFakeTimers();
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    const snapshots: DebugSnapshot[] = [];
    const attachment = attachDebug(world, { updateInterval: 100 });
    attachment.provider.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    vi.advanceTimersByTime(350);
    expect(snapshots).toHaveLength(3);
    attachment.detach();
    world.dispose();
  });

  it('follows pause and resume when the provider confirms them', () => {
    const provider = manualTickProvider();
    const world = new GameWorld({ tickFrameProvider: provider });
    world.start();
    const attachment = attachDebug(world, { updateInterval: 0 });
    expect(attachment.provider.getSnapshot().world.paused).toBe(false);
    world.pause();
    expect(attachment.provider.getSnapshot().world.paused).toBe(true);
    world.resume();
    expect(attachment.provider.getSnapshot().world.paused).toBe(false);
    attachment.detach();
    world.dispose();
  });

  it('follows pause and resume when the provider has no pause methods', () => {
    const world = new GameWorld({ tickFrameProvider: bareProvider() });
    const attachment = attachDebug(world, { updateInterval: 0 });
    world.pause();
    expect(attachment.provider.getSnapshot().world.paused).toBe(true);
    world.resume();
    expect(attachment.provider.getSnapshot().world.paused).toBe(false);
    attachment.detach();
    world.dispose();
  });

  it('reads an already paused world into the first snapshot', () => {
    const world = new GameWorld({ tickFrameProvider: bareProvider() });
    world.pause();
    const attachment = attachDebug(world, { updateInterval: 0 });
    expect(attachment.provider.getSnapshot().world.paused).toBe(true);
    attachment.detach();
    world.dispose();
  });

  it('does not create a panel when panel options are omitted', () => {
    const window = new Window();
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('window', window);
    const world = new GameWorld({ tickFrameProvider: bareProvider() });
    const attachment = attachDebug(world);
    expect(attachment.panel).toBeNull();
    expect(window.document.body.childElementCount).toBe(0);
    attachment.detach();
    world.dispose();
  });

  it('creates a panel node when panel options are set', () => {
    const window = new Window();
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('window', window);
    const world = new GameWorld({ tickFrameProvider: bareProvider() });
    const attachment = attachDebug(world, { panel: {} });
    expect(attachment.panel).not.toBeNull();
    expect(window.document.body.childElementCount).toBe(1);
    attachment.detach();
    world.dispose();
  });

  it('shows entities added to the world', () => {
    const world = new GameWorld({
      tickFrameProvider: bareProvider(),
      componentTypes: [HealthType],
    });
    const entity = world.createEntity((id) => new Entity(id));
    entity.addComponent(new HealthComponent(50));
    world.entityManager.addEntity(entity);
    const attachment = attachDebug(world, { updateInterval: 0 });
    const snapshot = attachment.provider.getSnapshot();
    expect(snapshot.world.entityCount).toBe(1);
    expect(snapshot.entities[0]?.components[0]?.data.hp).toBe(50);
    attachment.detach();
    world.dispose();
  });

  it('detach stops snapshots, ignores later pause, removes the panel, and is idempotent', () => {
    vi.useFakeTimers();
    const window = new Window();
    vi.stubGlobal('document', window.document);
    vi.stubGlobal('window', window);
    const world = new GameWorld({ tickFrameProvider: bareProvider() });
    const snapshots: DebugSnapshot[] = [];
    const attachment = attachDebug(world, {
      updateInterval: 100,
      panel: {},
    });
    attachment.provider.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    vi.advanceTimersByTime(150);
    expect(snapshots).toHaveLength(1);
    expect(window.document.body.childElementCount).toBe(1);
    const panel = attachment.panel;
    if (panel === null) {
      throw new Error('expected a panel');
    }
    const destroy = vi.spyOn(panel, 'destroy');

    attachment.detach();
    vi.advanceTimersByTime(500);
    expect(snapshots).toHaveLength(1);
    world.eventBus.emit(GameWorldEvents.PAUSED, {});
    world.eventBus.emit(GameWorldEvents.RESUMED, {});
    expect(attachment.provider.getSnapshot().world.paused).toBe(false);
    expect(window.document.body.childElementCount).toBe(0);
    expect(() => attachment.detach()).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
    world.dispose();
  });

  it('throws when a panel is requested without a DOM', () => {
    const world = new GameWorld({ tickFrameProvider: bareProvider() });
    expect(() => attachDebug(world, { panel: {} })).toThrow(
      'attachDebug: panel requires a DOM'
    );
    world.dispose();
  });
});
