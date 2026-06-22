import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Entity, EntityManager, EventBus, SoAComponent, SystemContext } from 'phalanx-ecs';
import { FP, FPVector3 } from 'phalanx-math';
import {
  TransformComponent,
  TransformSoASchema,
  TRANSFORM_COMPONENT_TYPE,
} from 'phalanx-physics';
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
      FPVector3.FromFloat(0, options.rotationY, 0),
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
    return FP.ToFloat(FP.FromRaw(transformStore.arrays.fpRotationY[index]));
  }

  it('rotates toward a target at turn speed instead of snapping instantly', () => {
    const target = addUnit({
      position: { x: 0, z: 10 },
      rotationY: 0,
      teamId: 1,
      targetEntityId: null,
    });
    const unit = addUnit({
      position: { x: 0, z: 0 },
      rotationY: Math.PI,
      teamId: 0,
      targetEntityId: target.id,
    });

    system.processTick();

    const rotationY = readRotationY(unit.id);
    expect(rotationY).not.toBeCloseTo(0);
    expect(rotationY).toBeCloseTo(Math.PI - UNIT_TURN_SPEED_RADIANS_PER_TICK, 5);
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
      rotationY: Math.PI,
      teamId: 0,
      targetEntityId: target.id,
    });

    const ticksToFaceTarget = Math.ceil(Math.PI / UNIT_TURN_SPEED_RADIANS_PER_TICK);
    for (let i = 0; i < ticksToFaceTarget; i++) {
      system.processTick();
    }

    expect(readRotationY(unit.id)).toBeCloseTo(0, 5);
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
      rotationY: Math.PI - 0.05,
      teamId: 0,
      targetEntityId: target.id,
    });

    system.processTick();

    const rotationY = readRotationY(unit.id);
    expect(rotationY).toBeGreaterThan(Math.PI - 0.05);
    expect(rotationY).toBeLessThanOrEqual(Math.PI);
  });

  it('rotates toward team default direction when there is no target', () => {
    const unit = addUnit({
      position: { x: 0, z: 0 },
      rotationY: Math.PI / 2,
      teamId: 0,
      targetEntityId: null,
    });

    system.processTick();

    const rotationY = readRotationY(unit.id);
    expect(rotationY).toBeLessThan(Math.PI / 2);
    expect(rotationY).toBeCloseTo(Math.PI / 2 - UNIT_TURN_SPEED_RADIANS_PER_TICK, 5);
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
      rotationY: Math.PI,
      teamId: 0,
      targetEntityId: target.id,
      alive: false,
    });

    system.processTick();

    expect(readRotationY(unit.id)).toBeCloseTo(Math.PI, 5);
  });

  it('does not implement frame-time visual rotation hooks', () => {
    expect('beforeTick' in system).toBe(false);
    expect('afterFrame' in system).toBe(false);
    expect('afterTick' in system).toBe(false);
    expect('beforeFrame' in system).toBe(false);
  });
});
