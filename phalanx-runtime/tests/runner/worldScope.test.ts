import { afterEach, describe, expect, it } from 'vitest';
import { GameWorld, SoAComponent, defineSoASchema } from '@phalanx-engine/ecs';
import { WorldScope } from '../../src/runner/WorldScope.js';
import { manualTickProvider } from '../support/manualTickProvider.js';

const PROBE_SCHEMA = defineSoASchema({ n: 'i64' }, 'ScopeProbe');

describe('WorldScope', () => {
  afterEach(() => {
    SoAComponent.resetContext();
  });

  it('switches the SoA manager and restores it when the scope ends', () => {
    const scopeA = new WorldScope();
    const scopeB = new WorldScope();
    const worlds: GameWorld[] = [];

    scopeA.run(() => {
      const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
      worlds.push(world);
      expect(SoAComponent.currentEntityManager()).toBe(world.entityManager);
    });
    expect(SoAComponent.currentEntityManager()).toBeNull();

    scopeB.run(() => {
      const worldB = new GameWorld({ tickFrameProvider: manualTickProvider() });
      worlds.push(worldB);
      expect(SoAComponent.currentEntityManager()).toBe(worldB.entityManager);
      worldB.dispose();
    });

    scopeA.run(() => {
      const world = worlds[0];
      SoAComponent.useEntityManager(world?.entityManager ?? null);
      const store = world?.entityManager.getOrCreateSoAStore(PROBE_SCHEMA);
      expect(SoAComponent.currentEntityManager()).toBe(world?.entityManager);
      expect(store).toBeDefined();
    });

    worlds[0]?.dispose();
  });

  it('restores the outer scope when a nested scope re-enters it', () => {
    const scopeA = new WorldScope();
    const scopeB = new WorldScope();
    const worlds: GameWorld[] = [];
    scopeA.run(() => {
      const worldA = new GameWorld({ tickFrameProvider: manualTickProvider() });
      worlds.push(worldA);
      expect(SoAComponent.currentEntityManager()).toBe(worldA.entityManager);
      scopeB.run(() => {
        const worldB = new GameWorld({
          tickFrameProvider: manualTickProvider(),
        });
        worlds.push(worldB);
        expect(SoAComponent.currentEntityManager()).toBe(worldB.entityManager);
        scopeA.run(() => {
          expect(SoAComponent.currentEntityManager()).toBe(
            worldA.entityManager
          );
        });
        expect(SoAComponent.currentEntityManager()).toBe(worldB.entityManager);
      });
      expect(SoAComponent.currentEntityManager()).toBe(worldA.entityManager);
    });
    for (const world of worlds) world.dispose();
  });

  it('does not touch the SoA manager when run re-enters the same scope', () => {
    const scope = new WorldScope();
    scope.run(() => {
      const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
      const manager = SoAComponent.currentEntityManager();
      scope.run(() => {
        expect(SoAComponent.currentEntityManager()).toBe(manager);
      });
      expect(SoAComponent.currentEntityManager()).toBe(world.entityManager);
      world.dispose();
    });
  });
});
