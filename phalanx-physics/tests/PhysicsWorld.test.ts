import { addBodyRow, attachedPhysics } from './support/physicsTestWorld.js';
import { manualTickProvider } from './support/manualTickProvider.js';
import { describe, it, expect } from 'vitest';
import { Entity, GameSystem, GameWorld } from '@phalanx-engine/ecs';
import { FPVector3, FPQuaternion } from '@phalanx-engine/math';
import { FP } from '@phalanx-engine/math';
import { PhysicsWorld } from '../src/PhysicsWorld';
import { Physics } from '../src/service';
import { PhysicsSystem } from '../src/systems/PhysicsSystem';
import { GravitySystem } from '../src/systems/GravitySystem';
import { InterpolationSystem } from '../src/systems/InterpolationSystem';
import {
  attachTransform,
  writeFpPosition,
  Transform,
} from '../src/components/transform';
import {
  attachInterpolation,
  Interpolation,
} from '../src/components/interpolation';

describe('PhysicsWorld', () => {
  it('attach registers components, service, systems and save section', () => {
    const { world, physics } = attachedPhysics();
    expect(world.componentNames()).toEqual(['Transform', 'PhysicsBody']);
    expect(
      world.registeredComponents().map((component) => component.name)
    ).toEqual(['Transform', 'PhysicsBody']);
    expect(world.context.getService(Physics)).toBe(physics);
    expect(world.saveSections.map((section) => section.key)).toEqual([
      'physics.broadphase',
    ]);
    expect(world.getSystem(PhysicsSystem)).toBeInstanceOf(PhysicsSystem);
    expect(world.getSystem(GravitySystem)).toBeInstanceOf(GravitySystem);
    expect(world.getSystem(InterpolationSystem)).toBeInstanceOf(
      InterpolationSystem
    );
    expect('getSystems' in physics).toBe(false);
  });

  it('runs attached tick systems before the game tick systems', () => {
    const order: string[] = [];
    class Probe extends GameSystem {
      public override processTick(): void {
        order.push('game');
      }
    }
    const { world, physicsSystem, gravitySystem } = attachedPhysics(undefined, [
      new Probe(),
    ]);
    const physicsTick = physicsSystem.processTick.bind(physicsSystem);
    physicsSystem.processTick = (tick) => {
      order.push('physics');
      physicsTick(tick);
    };
    const gravityTick = gravitySystem.processTick.bind(gravitySystem);
    gravitySystem.processTick = (tick) => {
      order.push('gravity');
      gravityTick(tick);
    };
    world.processAllTicks(1);
    expect(order).toEqual(['gravity', 'physics', 'game']);
  });

  it('runs an input system before gravity and the physics step', () => {
    const order: string[] = [];
    class Probe extends GameSystem {
      public override processTick(): void {
        order.push('game');
      }
    }
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    new PhysicsWorld().attach(world);
    const physicsSystem = world.getSystem(PhysicsSystem);
    if (physicsSystem === undefined) throw new Error('missing PhysicsSystem');
    const physicsTick = physicsSystem.processTick.bind(physicsSystem);
    physicsSystem.processTick = (tick) => {
      order.push('physics');
      physicsTick(tick);
    };
    world.addSystem(new Probe(), { phase: 'input' });
    world.processAllTicks(1);
    expect(order).toEqual(['game', 'physics']);
  });

  it('rejects a second add of an attached system', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    new PhysicsWorld().attach(world);
    const gravitySystem = world.getSystem(GravitySystem);
    if (gravitySystem === undefined) throw new Error('missing GravitySystem');
    expect(() => world.addSystem(gravitySystem, { phase: 'physics' })).toThrow(
      "world.addSystem: system 'GravitySystem' is already registered"
    );
  });

  it('attach after start throws', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    world.start();
    expect(() => new PhysicsWorld().attach(world)).toThrow(
      'world.addSystem: system order is frozen'
    );
  });

  it('exposes a gravitySystem configured from PhysicsWorldConfig', () => {
    const { gravitySystem } = attachedPhysics({ gravity: FP.FromFloat(9.8) });

    expect(gravitySystem).toBeInstanceOf(GravitySystem);
    expect(FP.ToFloat(gravitySystem.getGravity())).toBeCloseTo(9.8, 3);
    expect(gravitySystem.getGravityAxis()).toBe('y');
  });

  it('defaults gravity to 0 (GravitySystem no-op) when not configured', () => {
    const { gravitySystem } = attachedPhysics();

    expect(FP.ToFloat(gravitySystem.getGravity())).toBe(0);
  });

  it('applyImpulse3D delegates to PhysicsSystem and sets all three axes', () => {
    const { physics: physicsWorld, physicsSystem } = attachedPhysics();

    const physicsStore = physicsSystem.getPhysicsStore();
    addBodyRow(physicsStore, 1, {
      velocityX: FP.ToRaw(FP._0),
      velocityY: FP.ToRaw(FP._0),
      velocityZ: FP.ToRaw(FP._0),
      radius: FP.ToRaw(FP._1),
      mass: FP.ToRaw(FP._1),
      restitution: FP.ToRaw(FP.FromFloat(0.5)),
      friction: FP.ToRaw(FP._1),
      isStatic: 0,
      ignorePhysics: 0,
      useGravity: 0,
      gravityMultiplier: FP.ToRaw(FP._1),
    });

    physicsWorld.applyImpulse3D(
      1,
      FP.FromFloat(1),
      FP.FromFloat(2),
      FP.FromFloat(3)
    );

    const idx = physicsStore.indexOf(1);
    expect(
      FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityX[idx]))
    ).toBeCloseTo(1, 4);
    expect(
      FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityY[idx]))
    ).toBeCloseTo(2, 4);
    expect(
      FP.ToFloat(FP.FromRaw(physicsStore.arrays.velocityZ[idx]))
    ).toBeCloseTo(3, 4);
  });

  it('getInterpolatedTransform delegates to the owned interpolation system', () => {
    const {
      world,
      physics: physicsWorld,
      interpolationSystem,
    } = attachedPhysics();
    const entityManager = world.entityManager;

    const entity = new Entity(entityManager.allocateEntityId());
    attachTransform(
      entity,
      FPVector3.FromFloat(0, 0, 0),
      FPQuaternion.Identity()
    );
    attachInterpolation(
      entity,
      FPVector3.FromFloat(0, 0, 0),
      FPQuaternion.Identity()
    );
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, Transform.type);
    entityManager.onComponentAdded(entity, Interpolation.type);

    writeFpPosition(entity, FPVector3.FromFloat(10, 0, 0));

    interpolationSystem.snapshot();
    interpolationSystem.capture();
    writeFpPosition(entity, FPVector3.FromFloat(20, 0, 0));
    interpolationSystem.capture();
    interpolationSystem.interpolate(0.5);

    const sample = physicsWorld.getInterpolatedTransform(entity.id);
    expect(sample).toBeDefined();
    expect(sample!.position.x).toBeCloseTo(15, 5);
    expect(sample!.position.y).toBeCloseTo(0, 5);
    expect(sample!.position.z).toBeCloseTo(0, 5);
  });

  it('does not expose setTransformStore', () => {
    const physicsWorld = new PhysicsWorld();
    expect('setTransformStore' in physicsWorld).toBe(false);
  });

  it('getInterpolatedTransform returns undefined for unknown entities', () => {
    const { physics: physicsWorld } = attachedPhysics();

    expect(physicsWorld.getInterpolatedTransform(999)).toBeUndefined();
  });
});
