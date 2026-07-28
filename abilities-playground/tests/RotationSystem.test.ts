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
  TurretComponent,
} from '../src/components';
import { RotationSystem } from '../src/systems/RotationSystem';
import {
  TURRET_TURN_SPEED_RADIANS_PER_TICK,
  UNIT_TURN_SPEED_RADIANS_PER_TICK,
} from '../src/config/constants';

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
      ComponentType.Turret,
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
    stopRange?: number;
    hasTurret?: boolean;
  }): Entity {
    const entity = new Entity();
    const transform = new TransformComponent(
      entity.id,
      FPVector3.FromFloat(options.position.x, 0, options.position.z),
      FPQuaternion.FromAxisAngle(FPVector3.Up, FP.FromFloat(options.rotationY)),
    );
    const targetState = new TargetStateComponent();
    targetState.targetEntityId = options.targetEntityId;
    const stats = new StatsComponent({ stopRange: options.stopRange ?? 1 });
    if (options.alive === false) stats.alive = false;

    entity.addComponent(transform);
    entity.addComponent(new TeamComponent(options.teamId));
    entity.addComponent(targetState);
    entity.addComponent(stats);
    if (options.hasTurret) entity.addComponent(new TurretComponent());
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, TRANSFORM_COMPONENT_TYPE);
    entityManager.onComponentAdded(entity, ComponentType.Team);
    entityManager.onComponentAdded(entity, ComponentType.TargetState);
    entityManager.onComponentAdded(entity, ComponentType.UnitStats);
    if (options.hasTurret) {
      entityManager.onComponentAdded(entity, ComponentType.Turret);
    }

    return entity;
  }

  function turretYaw(entity: Entity): number {
    return FP.ToFloat(
      entity.getComponent<TurretComponent>(ComponentType.Turret)!.yaw,
    );
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

  describe('turreted units', () => {
    it('turns the hull and keeps the turret centered while out of attack range', () => {
      const target = addUnit({
        position: { x: 10, z: 0 },
        rotationY: 0,
        teamId: 1,
        targetEntityId: null,
      });
      const unit = addUnit({
        position: { x: 0, z: 0 },
        rotationY: 0,
        teamId: 0,
        targetEntityId: target.id,
        stopRange: 4,
        hasTurret: true,
      });

      system.processTick();

      expect(readRotationY(unit.id)).toBeCloseTo(
        UNIT_TURN_SPEED_RADIANS_PER_TICK,
        2,
      );
      expect(turretYaw(unit)).toBeCloseTo(0, 5);
    });

    it('holds the hull still and traverses the turret once in attack range', () => {
      const target = addUnit({
        position: { x: 10, z: 0 },
        rotationY: 0,
        teamId: 1,
        targetEntityId: null,
      });
      const unit = addUnit({
        position: { x: 0, z: 0 },
        rotationY: 0,
        teamId: 0,
        targetEntityId: target.id,
        stopRange: 20,
        hasTurret: true,
      });

      const hullBefore = readStoredQuaternion(unit.id);
      system.processTick();

      expect(readStoredQuaternion(unit.id)).toEqual(hullBefore);
      expect(turretYaw(unit)).toBeCloseTo(
        TURRET_TURN_SPEED_RADIANS_PER_TICK,
        2,
      );
    });

    it('traverses the turret onto the target and leaves the hull untouched', () => {
      const target = addUnit({
        position: { x: 10, z: 0 },
        rotationY: 0,
        teamId: 1,
        targetEntityId: null,
      });
      const unit = addUnit({
        position: { x: 0, z: 0 },
        rotationY: 0,
        teamId: 0,
        targetEntityId: target.id,
        stopRange: 20,
        hasTurret: true,
      });

      const ticks = Math.ceil(
        Math.PI / 2 / TURRET_TURN_SPEED_RADIANS_PER_TICK,
      );
      for (let i = 0; i < ticks; i++) system.processTick();

      // Target sits at +X: yaw = atan2(dx, dz) = +PI/2 relative to a hull that
      // never moved off 0.
      expect(turretYaw(unit)).toBeCloseTo(Math.PI / 2, 2);
      expect(readRotationY(unit.id)).toBeCloseTo(0, 5);
    });

    it('recenters the turret when the target is lost', () => {
      const target = addUnit({
        position: { x: 10, z: 0 },
        rotationY: 0,
        teamId: 1,
        targetEntityId: null,
      });
      const unit = addUnit({
        position: { x: 0, z: 0 },
        rotationY: 0,
        teamId: 0,
        targetEntityId: target.id,
        stopRange: 20,
        hasTurret: true,
      });

      system.processTick();
      system.processTick();
      const traversed = turretYaw(unit);
      expect(traversed).toBeGreaterThan(0);

      unit.getComponent<TargetStateComponent>(
        ComponentType.TargetState,
      )!.targetEntityId = null;
      system.processTick();

      expect(turretYaw(unit)).toBeLessThan(traversed);
    });
  });
});
