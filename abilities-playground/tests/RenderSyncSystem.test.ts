import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Entity, EntityManager, EventBus, SystemContext } from '@phalanx-engine/ecs';
import type { IPhysicsWorld } from '@phalanx-engine/ecs';
import { INTERPOLATION_COMPONENT_TYPE } from '@phalanx-engine/physics';
import {
  ComponentType,
  HealAuraComponent,
  HealthBarComponent,
  InterpolationComponent,
  MeshComponent,
  StatsComponent,
  TeamComponent,
} from '../src/components';
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

  it('tracks the unit position with a flat ground ring, decoupled from body yaw', () => {
    entityManager.registerComponentTypes([
      ComponentType.HealthBar,
      ComponentType.Team,
      ComponentType.UnitStats,
      ComponentType.HealAura,
    ]);

    const entity = new Entity();
    const meshRoot = new THREE.Object3D();
    // The ring is an independent world-space decal (NOT a child of the body),
    // mirroring how UnitFactory adds it straight to the scene.
    const auraRing = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 96));
    auraRing.rotation.x = -Math.PI / 2;

    entity.addComponent(new MeshComponent(meshRoot));
    entity.addComponent(new InterpolationComponent());
    entity.addComponent(new HealthBarComponent(new THREE.Object3D(), new THREE.Object3D(), 6));
    entity.addComponent(new TeamComponent(1));
    entity.addComponent(new StatsComponent({ stopRange: 22 }));
    entity.addComponent(new HealAuraComponent({ radius: 18, pulseTicks: 30 }, auraRing));
    entityManager.addEntity(entity);
    for (const type of [
      ComponentType.Mesh,
      INTERPOLATION_COMPONENT_TYPE,
      ComponentType.HealthBar,
      ComponentType.Team,
      ComponentType.UnitStats,
      ComponentType.HealAura,
    ]) {
      entityManager.onComponentAdded(entity, type);
    }

    context.physics = {
      getInterpolatedTransform: () => undefined,
    } as unknown as IPhysicsWorld;
    context.abilities = {
      tryGetAttribute: () => undefined,
    } as unknown as SystemContext['abilities'];

    const flat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -Math.PI / 2,
    );
    const worldRotation = new THREE.Quaternion();

    // The unit re-orients across the ±π wrap (team 1 faces ≈π) and moves around.
    // The ring must follow the body's X/Z, sit on the ground, and stay perfectly
    // flat in world space for every body yaw — never inheriting the rotation.
    for (const [yaw, x, z] of [
      [Math.PI, 4, -7],
      [Math.PI - 0.02, -3, 9],
      [Math.PI + 0.03, 12, 1],
    ]) {
      meshRoot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      meshRoot.position.set(x, 2, z);
      system.update(0.016);
      auraRing.updateMatrixWorld(true);
      auraRing.getWorldQuaternion(worldRotation);

      expect(auraRing.position.x).toBeCloseTo(x);
      expect(auraRing.position.z).toBeCloseTo(z);
      expect(auraRing.position.y).toBeCloseTo(0.05);
      expect(worldRotation.x).toBeCloseTo(flat.x, 6);
      expect(worldRotation.y).toBeCloseTo(flat.y, 6);
      expect(worldRotation.z).toBeCloseTo(flat.z, 6);
      expect(worldRotation.w).toBeCloseTo(flat.w, 6);
    }
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
