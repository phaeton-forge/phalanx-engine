import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import {
  Entity,
  EntityManager,
  EventBus,
  SoAComponent,
  SystemContext,
} from '@phalanx-engine/ecs';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import type { FPQuaternion as FPQuaternionType } from '@phalanx-engine/math';
import {
  PhysicsSoASchema,
  PHYSICS_BODY_COMPONENT_TYPE,
  TransformComponent,
  TransformSoASchema,
  TRANSFORM_COMPONENT_TYPE,
  INTERPOLATION_COMPONENT_TYPE,
} from '@phalanx-engine/physics';
import { ComponentType, MeshComponent, MissileComponent } from '../src/components';
import { StatsComponent } from '../src/components/UnitComponents';
import { MissileEntity } from '../src/entities/Missile';
import { MissileMovementSystem } from '../src/systems/MissileMovementSystem';
import { MissileTargetingSystem } from '../src/systems/MissileTargetingSystem';
import {
  MISSILE_ATTACK_RANGE,
  MISSILE_LAUNCH_ARC_FALLOFF,
} from '../src/config/constants';

function readRotation(
  transformStore: ReturnType<EntityManager['getOrCreateSoAStore']>,
  entityId: number,
): FPQuaternionType {
  const index = transformStore.indexOf(entityId);
  return {
    x: FP.FromRaw(transformStore.arrays.fpRotationX[index]),
    y: FP.FromRaw(transformStore.arrays.fpRotationY[index]),
    z: FP.FromRaw(transformStore.arrays.fpRotationZ[index]),
    w: FP.FromRaw(transformStore.arrays.fpRotationW[index]),
  };
}

function addEntityWithTransform(
  entityManager: EntityManager,
  entity: Entity,
): void {
  entityManager.addEntity(entity);
  entityManager.onComponentAdded(entity, TRANSFORM_COMPONENT_TYPE);
}

function addTarget(entityManager: EntityManager, position: FPVector3): Entity {
  const target = new Entity();
  target.addComponent(
    new TransformComponent(target.id, position, FPQuaternion.Identity()),
  );
  target.addComponent(new StatsComponent({ stopRange: 18 }));
  addEntityWithTransform(entityManager, target);
  return target;
}

describe('Missile FP quaternion migration', () => {
  let entityManager: EntityManager;
  let transformStore: ReturnType<EntityManager['getOrCreateSoAStore']>;

  beforeEach(() => {
    MeshComponent.initScene(new THREE.Scene());
    entityManager = new EntityManager();
    entityManager.registerComponentTypes([
      TRANSFORM_COMPONENT_TYPE,
      PHYSICS_BODY_COMPONENT_TYPE,
      INTERPOLATION_COMPONENT_TYPE,
      ComponentType.Missile,
    ]);
    SoAComponent.useEntityManager(entityManager);
    transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);
    entityManager.getOrCreateSoAStore(PhysicsSoASchema);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  describe('MissileTargetingSystem', () => {
    let targetingSystem: MissileTargetingSystem;

    beforeEach(() => {
      const context = new SystemContext(new EventBus(), entityManager);
      targetingSystem = new MissileTargetingSystem();
      targetingSystem.init(context);
    });

    it('slerps toward a level target and keeps a unit quaternion', () => {
      const target = new Entity();
      target.addComponent(
        new TransformComponent(
          target.id,
          FPVector3.FromFloat(10, 0, 0),
          FPQuaternion.Identity(),
        ),
      );
      addEntityWithTransform(entityManager, target);

      const missile = new Entity();
      missile.addComponent(
        new TransformComponent(
          missile.id,
          FPVector3.FromFloat(0, 0, 0),
          FPQuaternion.Identity(),
        ),
      );
      const mc = new MissileComponent();
      mc.phase = 'approach';
      mc.targetEntityId = target.id;
      missile.addComponent(mc);
      addEntityWithTransform(entityManager, missile);
      entityManager.onComponentAdded(missile, ComponentType.Missile);

      const initialYaw = FP.ToFloat(
        FPQuaternion.ToEulerXYZ(readRotation(transformStore, missile.id)).y,
      );
      expect(initialYaw).toBeCloseTo(0, 2);

      for (let i = 0; i < 24; i++) {
        targetingSystem.processTick();
      }

      const rotation = readRotation(transformStore, missile.id);
      const finalYaw = FP.ToFloat(FPQuaternion.ToEulerXYZ(rotation).y);
      expect(finalYaw).toBeGreaterThan(initialYaw);
      expect(finalYaw).toBeCloseTo(Math.PI / 2, 1);
      expect(FP.ToFloat(FPQuaternion.Magnitude(rotation))).toBeCloseTo(1, 3);
    });
  });

  describe('MissileEntity.onSpawn', () => {
    it('seeds a unit quaternion into transform SoA and interpolation', () => {
      const missile = new MissileEntity();
      entityManager.addEntity(missile);
      entityManager.onComponentAdded(missile, TRANSFORM_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, PHYSICS_BODY_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, INTERPOLATION_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, ComponentType.Missile);

      missile.onSpawn({
        fpPosition: FPVector3.FromFloat(0, 0, 0),
        targetEntityId: 999,
        teamId: 0,
        volleyIndex: 0,
        volleyCount: 1,
      });

      const rotation = readRotation(transformStore, missile.id);
      expect(FP.ToFloat(FPQuaternion.Magnitude(rotation))).toBeCloseTo(1, 3);
      expect(Number.isNaN(FP.ToFloat(rotation.w))).toBe(false);

      const interpolation = missile.getComponent(ComponentType.Interpolation);
      expect(interpolation).toBeDefined();
      expect(FP.ToFloat(interpolation!.currentFpRotation.w)).toBeCloseTo(
        FP.ToFloat(rotation.w),
        3,
      );
    });

    it('launches within the forward hemisphere relative to the launcher', () => {
      const missile = new MissileEntity();
      entityManager.addEntity(missile);
      entityManager.onComponentAdded(missile, TRANSFORM_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, PHYSICS_BODY_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, INTERPOLATION_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, ComponentType.Missile);

      const launcherRotation = FPQuaternion.FromYaw(FP.FromFloat(Math.PI / 2));
      missile.onSpawn({
        fpPosition: FPVector3.FromFloat(0, 0, 0),
        targetEntityId: 999,
        teamId: 0,
        volleyIndex: 0,
        volleyCount: 3,
        launcherRotation,
      });

      const mc = missile.getComponent<MissileComponent>(ComponentType.Missile)!;
      const launcherForward = FPQuaternion.RotateVector(
        launcherRotation,
        FPVector3.Forward,
      );
      const launchFlat = { x: mc.launchSpreadX, y: FP._0, z: mc.launchSpreadZ };
      const dot = FP.Add(
        FP.Mul(launchFlat.x, launcherForward.x),
        FP.Mul(launchFlat.z, launcherForward.z),
      );
      expect(FP.ToFloat(dot)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('MissileMovementSystem', () => {
    let movementSystem: MissileMovementSystem;

    beforeEach(() => {
      const context = new SystemContext(new EventBus(), entityManager);
      movementSystem = new MissileMovementSystem();
      movementSystem.init(context);
    });

    it('homes horizontally during approach instead of following launch pitch', () => {
      const target = addTarget(entityManager, FPVector3.FromFloat(30, 0, 0));

      const missile = new MissileEntity();
      entityManager.addEntity(missile);
      entityManager.onComponentAdded(missile, TRANSFORM_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, PHYSICS_BODY_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, ComponentType.Missile);

      const transform = missile.getComponent<TransformComponent>(TRANSFORM_COMPONENT_TYPE)!;
      transform.fpPosition = FPVector3.FromFloat(0, 0, 0);
      transform.fpRotation = FPQuaternion.FromAxisAngle(
        FPVector3.Right,
        FP.FromFloat(-Math.PI / 4),
      );

      const mc = missile.getComponent<MissileComponent>(ComponentType.Missile)!;
      mc.phase = 'approach';
      mc.targetEntityId = target.id;
      mc.spawnY = FP._0;
      mc.launchHeightScale = FP._1;
      missile.active = true;

      const idx = transformStore.indexOf(missile.id);
      const startX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx]));
      const startY = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[idx]));

      movementSystem.processTick(0);

      const endX = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionX[idx]));
      const endY = FP.ToFloat(FP.FromRaw(transformStore.arrays.fpPositionY[idx]));
      expect(endX).toBeGreaterThan(startX);
      expect(endY).toBeGreaterThanOrEqual(startY);
    });

    it('skips launch and enters attack when the target is within attack range', () => {
      const target = addTarget(
        entityManager,
        FPVector3.FromFloat(MISSILE_ATTACK_RANGE - 5, 0, 0),
      );

      const missile = new MissileEntity();
      entityManager.addEntity(missile);
      entityManager.onComponentAdded(missile, TRANSFORM_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, PHYSICS_BODY_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, ComponentType.Missile);

      const transform = missile.getComponent<TransformComponent>(TRANSFORM_COMPONENT_TYPE)!;
      transform.fpPosition = FPVector3.FromFloat(0, 0, 0);
      transform.fpRotation = FPQuaternion.Identity();

      const mc = missile.getComponent<MissileComponent>(ComponentType.Missile)!;
      mc.phase = 'launch';
      mc.targetEntityId = target.id;
      mc.spawnY = FP._0;
      mc.launchHeightScale = FP._1;
      missile.active = true;

      movementSystem.processTick(0);

      expect(mc.phase).toBe('attack');
    });

    it('skips launch and enters approach when the target is within arc falloff', () => {
      const target = addTarget(
        entityManager,
        FPVector3.FromFloat(MISSILE_LAUNCH_ARC_FALLOFF - 5, 0, 0),
      );

      const missile = new MissileEntity();
      entityManager.addEntity(missile);
      entityManager.onComponentAdded(missile, TRANSFORM_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, PHYSICS_BODY_COMPONENT_TYPE);
      entityManager.onComponentAdded(missile, ComponentType.Missile);

      const transform = missile.getComponent<TransformComponent>(TRANSFORM_COMPONENT_TYPE)!;
      transform.fpPosition = FPVector3.FromFloat(0, 0, 0);
      transform.fpRotation = FPQuaternion.Identity();

      const mc = missile.getComponent<MissileComponent>(ComponentType.Missile)!;
      mc.phase = 'launch';
      mc.targetEntityId = target.id;
      mc.spawnY = FP._0;
      mc.launchHeightScale = FP._1;
      missile.active = true;

      movementSystem.processTick(0);

      expect(mc.phase).toBe('approach');
    });
  });
});
