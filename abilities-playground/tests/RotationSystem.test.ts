import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Entity, EntityManager, EventBus, SoAComponent, SystemContext } from '@phalanx-engine/ecs';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import {
  TransformComponent,
  TransformSoASchema,
  TRANSFORM_COMPONENT_TYPE,
} from '@phalanx-engine/physics';
import {
  ComponentType,
  StatsComponent,
  TargetStateComponent,
  TeamComponent,
} from '../src/components';
import { RotationSystem } from '../src/systems/RotationSystem';
import { UNIT_TURN_SPEED_RADIANS_PER_TICK } from '../src/config/constants';

describe('RotationSystem', () => {
  let entityManager: EntityManager;
  let system: RotationSystem;
  let transformStore: ReturnType<EntityManager['getOrCreateSoAStore']>;

  beforeEach(() => {
    entityManager = new EntityManager();
    entityManager.registerComponentTypes([
      TRANSFORM_COMPONENT_TYPE,
      ComponentType.Team,
      ComponentType.TargetState,
      ComponentType.UnitStats,
    ]);
    SoAComponent.useEntityManager(entityManager);

    const context = new SystemContext(new EventBus(), entityManager);
    system = new RotationSystem();
    system.init(context);
    transformStore = entityManager.getOrCreateSoAStore(TransformSoASchema);
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  function addUnit(options: {
    position: { x: number; z: number };
    rotationY: number;
    teamId: 0 | 1;
    targetEntityId: number | null;
    alive?: boolean;
  }): Entity {
    const entity = new Entity();
    const transform = new TransformComponent(
      entity.id,
      FPVector3.FromFloat(options.position.x, 0, options.position.z),
      FPQuaternion.FromAxisAngle(FPVector3.Up, FP.FromFloat(options.rotationY)),
    );
    const targetState = new TargetStateComponent();
    targetState.targetEntityId = options.targetEntityId;
    const stats = new StatsComponent({ stopRange: 1 });
    if (options.alive === false) stats.alive = false;

    entity.addComponent(transform);
    entity.addComponent(new TeamComponent(options.teamId));
    entity.addComponent(targetState);
    entity.addComponent(stats);
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, TRANSFORM_COMPONENT_TYPE);
    entityManager.onComponentAdded(entity, ComponentType.Team);
    entityManager.onComponentAdded(entity, ComponentType.TargetState);
    entityManager.onComponentAdded(entity, ComponentType.UnitStats);

    return entity;
  }

  function readRotationY(entityId: number): number {
    const index = transformStore.indexOf(entityId);
    const ax = transformStore.arrays;
    const x = FP.FromRaw(ax.fpRotationX[index]);
    const y = FP.FromRaw(ax.fpRotationY[index]);
    const z = FP.FromRaw(ax.fpRotationZ[index]);
    const w = FP.FromRaw(ax.fpRotationW[index]);
    const two = FP.FromInt(2);
    const sinY = FP.Mul(two, FP.Add(FP.Mul(w, y), FP.Mul(x, z)));
    const cosY = FP.Sub(FP._1, FP.Mul(two, FP.Add(FP.Mul(y, y), FP.Mul(z, z))));
    return FP.ToFloat(FP.Atan2(sinY, cosY));
  }

  function readStoredQuaternion(entityId: number) {
    const index = transformStore.indexOf(entityId);
    const ax = transformStore.arrays;
    return {
      x: ax.fpRotationX[index],
      y: ax.fpRotationY[index],
      z: ax.fpRotationZ[index],
      w: ax.fpRotationW[index],
    };
  }

  it('rotates toward a target at turn speed instead of snapping instantly', () => {
    const target = addUnit({
      position: { x: 0, z: 10 },
      rotationY: 0,
      teamId: 1,
      targetEntityId: null,
    });
    const startRotationY = Math.PI - 0.2;
    const unit = addUnit({
      position: { x: 0, z: 0 },
      rotationY: startRotationY,
      teamId: 0,
      targetEntityId: target.id,
    });

    const before = readRotationY(unit.id);
    system.processTick();
    const after = readRotationY(unit.id);

    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThan(0);
    expect(before - after).toBeGreaterThan(0);
    expect(before - after).toBeLessThan(UNIT_TURN_SPEED_RADIANS_PER_TICK * 1.5);
  });

  it('reaches target facing after enough ticks', () => {
    const target = addUnit({
      position: { x: 0, z: 10 },
      rotationY: 0,
      teamId: 1,
      targetEntityId: null,
    });
    const unit = addUnit({
      position: { x: 0, z: 0 },
      rotationY: Math.PI - 0.2,
      teamId: 0,
      targetEntityId: target.id,
    });

    const ticksToFaceTarget = Math.ceil(Math.PI / UNIT_TURN_SPEED_RADIANS_PER_TICK);
    for (let i = 0; i < ticksToFaceTarget; i++) {
      system.processTick();
    }

    expect(Math.abs(readRotationY(unit.id))).toBeLessThan(0.35);
  });

  it('uses shortest-path rotation near +PI and -PI', () => {
    const target = addUnit({
      position: { x: 0, z: -10 },
      rotationY: 0,
      teamId: 1,
      targetEntityId: null,
    });
    const unit = addUnit({
      position: { x: 0, z: 0 },
      rotationY: 0.1,
      teamId: 0,
      targetEntityId: target.id,
    });

    const before = readRotationY(unit.id);
    system.processTick();
    const after = readRotationY(unit.id);

    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(Math.PI);
  });

  it('rotates toward team default direction when there is no target', () => {
    const unit = addUnit({
      position: { x: 0, z: 0 },
      rotationY: Math.PI / 2,
      teamId: 0,
      targetEntityId: null,
    });

    const before = readRotationY(unit.id);
    system.processTick();
    const after = readRotationY(unit.id);

    expect(after).toBeLessThan(before);
    expect(before - after).toBeCloseTo(UNIT_TURN_SPEED_RADIANS_PER_TICK, 0);
  });

  it('skips dead units', () => {
    const target = addUnit({
      position: { x: 0, z: 10 },
      rotationY: 0,
      teamId: 1,
      targetEntityId: null,
    });
    const unit = addUnit({
      position: { x: 0, z: 0 },
      rotationY: Math.PI - 0.2,
      teamId: 0,
      targetEntityId: target.id,
      alive: false,
    });

    const before = readStoredQuaternion(unit.id);
    system.processTick();
    const after = readStoredQuaternion(unit.id);

    expect(after).toEqual(before);
  });

  it('does not implement frame-time visual rotation hooks', () => {
    expect('beforeTick' in system).toBe(false);
    expect('afterFrame' in system).toBe(false);
    expect('afterTick' in system).toBe(false);
    expect('beforeFrame' in system).toBe(false);
  });
});
