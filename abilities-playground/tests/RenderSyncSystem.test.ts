import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Entity, EntityManager, EventBus, SystemContext } from '@phalanx-engine/ecs';
import type { IPhysicsWorld } from '@phalanx-engine/ecs';
import { INTERPOLATION_COMPONENT_TYPE } from '@phalanx-engine/physics';
import { ComponentType, InterpolationComponent, MeshComponent } from '../src/components';
import { RenderSyncSystem } from '../src/systems/RenderSyncSystem';

describe('RenderSyncSystem', () => {
  let entityManager: EntityManager;
  let system: RenderSyncSystem;
  let context: SystemContext;

  beforeEach(() => {
    MeshComponent.initScene(new THREE.Scene());
    entityManager = new EntityManager();
    entityManager.registerComponentTypes([
      ComponentType.Mesh,
      INTERPOLATION_COMPONENT_TYPE,
    ]);
    context = new SystemContext(new EventBus(), entityManager);
    system = new RenderSyncSystem();
    system.init(context);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies interpolated transform from PhysicsWorld to mesh root', () => {
    const entity = new Entity();
    const meshRoot = new THREE.Object3D();
    entity.addComponent(new MeshComponent(meshRoot));
    entity.addComponent(new InterpolationComponent());
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, ComponentType.Mesh);
    entityManager.onComponentAdded(entity, INTERPOLATION_COMPONENT_TYPE);

    const getInterpolatedTransform = vi.fn(() => ({
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
    }));
    context.physics = { getInterpolatedTransform } as unknown as IPhysicsWorld;

    system.update(0.016);

    expect(getInterpolatedTransform).toHaveBeenCalledWith(entity.id);
    expect(meshRoot.position.x).toBeCloseTo(1);
    expect(meshRoot.position.y).toBeCloseTo(2);
    expect(meshRoot.position.z).toBeCloseTo(3);
    expect(meshRoot.quaternion.x).toBeCloseTo(0.1);
    expect(meshRoot.quaternion.y).toBeCloseTo(0.2);
    expect(meshRoot.quaternion.z).toBeCloseTo(0.3);
    expect(meshRoot.quaternion.w).toBeCloseTo(0.9);
  });

  it('leaves mesh unchanged when physics returns no sample', () => {
    const entity = new Entity();
    const meshRoot = new THREE.Object3D();
    meshRoot.position.set(5, 6, 7);
    meshRoot.quaternion.set(0.1, 0.2, 0.3, 0.9);
    entity.addComponent(new MeshComponent(meshRoot));
    entity.addComponent(new InterpolationComponent());
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, ComponentType.Mesh);
    entityManager.onComponentAdded(entity, INTERPOLATION_COMPONENT_TYPE);

    context.physics = {
      getInterpolatedTransform: () => undefined,
    } as unknown as IPhysicsWorld;

    system.update(0.016);

    expect(meshRoot.position.x).toBeCloseTo(5);
    expect(meshRoot.position.y).toBeCloseTo(6);
    expect(meshRoot.position.z).toBeCloseTo(7);
    expect(meshRoot.quaternion.x).toBeCloseTo(0.1);
    expect(meshRoot.quaternion.y).toBeCloseTo(0.2);
    expect(meshRoot.quaternion.z).toBeCloseTo(0.3);
    expect(meshRoot.quaternion.w).toBeCloseTo(0.9);
  });
});
