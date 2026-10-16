import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Entity,
  EntityManager,
  EventBus,
  SoAComponent,
  SystemContext,
} from '@phalanx-engine/ecs';
import type { GameWorld } from '@phalanx-engine/ecs';
import { FP, FPVector3 } from '@phalanx-engine/math';
import {
  TransformComponent,
  TRANSFORM_COMPONENT_TYPE,
} from '@phalanx-engine/physics';
import {
  ComponentType,
  StatsComponent,
  TeamComponent,
  ArtilleryShellComponent,
  ShrapnelPayloadComponent,
} from '../src/components';
import { ArtilleryShellSystem } from '../src/systems/ArtilleryShellSystem';
import {
  ShrapnelLandingSystem,
  computeGroundLanding,
} from '../src/systems/ShrapnelLandingSystem';
import { DeterministicRandom } from '@phalanx-engine/client';
import { sauArtillery } from '../src/hooks/SauArtillery';
import {
  SAU_SHRAPNEL_COUNT,
  SAU_MIN_ENGAGEMENT_RANGE,
} from '../src/config/abilityDefinitions';
import {
  SAU_SHRAPNEL_CONE,
  SAU_SHRAPNEL_SPEED,
} from '../src/config/constants';

function makeManager(): EntityManager {
  const entityManager = new EntityManager();
  entityManager.registerComponentTypes([
    TRANSFORM_COMPONENT_TYPE,
    ComponentType.Team,
    ComponentType.UnitStats,
    ComponentType.ArtilleryShell,
    ComponentType.ShrapnelPayload,
  ]);
  SoAComponent.useEntityManager(entityManager);
  return entityManager;
}

function addTransformUnit(
  entityManager: EntityManager,
  pos: { x: number; y: number; z: number },
  teamId: 0 | 1
): Entity {
  const entity = new Entity();
  entity.addComponent(
    new TransformComponent(
      entity.id,
      FPVector3.FromFloat(pos.x, pos.y, pos.z)
    )
  );
  entity.addComponent(new TeamComponent(teamId));
  entityManager.addEntity(entity);
  entityManager.onComponentAdded(entity, TRANSFORM_COMPONENT_TYPE);
  entityManager.onComponentAdded(entity, ComponentType.Team);
  return entity;
}

describe('computeGroundLanding (FP safety + landing point)', () => {
  it('returns null when the segment does not cross the ground plane', () => {
    // Both endpoints above ground.
    expect(
      computeGroundLanding(
        FP.FromFloat(0),
        FP.FromFloat(5),
        FP.FromFloat(0),
        FP.FromFloat(0),
        FP.FromFloat(2),
        FP.FromFloat(0)
      )
    ).toBeNull();
    // Ascending (below → above) is not a downward crossing.
    expect(
      computeGroundLanding(
        FP.FromFloat(0),
        FP.FromFloat(-1),
        FP.FromFloat(0),
        FP.FromFloat(0),
        FP.FromFloat(3),
        FP.FromFloat(0)
      )
    ).toBeNull();
  });

  it('interpolates the exact crossing point without dividing by zero', () => {
    // prevY=5 → curY=-1 over dx=2..2 dz=3..3 crosses at t=5/6.
    const landing = computeGroundLanding(
      FP.FromFloat(2),
      FP.FromFloat(5),
      FP.FromFloat(3),
      FP.FromFloat(2),
      FP.FromFloat(-1),
      FP.FromFloat(3)
    );
    expect(landing).not.toBeNull();
    expect(FP.ToFloat(landing!.x)).toBeCloseTo(2, 5);
    expect(FP.ToFloat(landing!.y)).toBeCloseTo(0, 5);
    expect(FP.ToFloat(landing!.z)).toBeCloseTo(3, 5);
  });

  it('never throws across many crossing configurations (FP.Div guard)', () => {
    for (let i = 1; i <= 50; i++) {
      const prevY = FP.FromFloat(i * 0.13);
      const curY = FP.FromFloat(-i * 0.07);
      expect(() =>
        computeGroundLanding(
          FP.FromFloat(i),
          prevY,
          FP.FromFloat(-i),
          FP.FromFloat(i + 1),
          curY,
          FP.FromFloat(-i - 1)
        )
      ).not.toThrow();
    }
  });
});

describe('sauArtillery hook', () => {
  let entityManager: EntityManager;
  let spawn: ReturnType<typeof vi.fn>;
  let world: GameWorld;

  beforeEach(() => {
    entityManager = makeManager();
    spawn = vi.fn(() => ({ id: 9999 }));
    world = {
      entityManager,
      eventBus: new EventBus(),
      pools: { spawn },
    } as unknown as GameWorld;
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  function fireAt(target: Entity, caster: Entity): void {
    sauArtillery(
      {
        tick: 100,
        casterEntityId: caster.id,
        resolvedTargets: [target.id],
      } as never,
      world
    );
  }

  it('snapshots the impact point independent of later target movement', () => {
    const caster = addTransformUnit(entityManager, { x: 0, y: 0, z: 0 }, 0);
    const target = addTransformUnit(entityManager, { x: 0, y: 0, z: 50 }, 1);

    fireAt(target, caster);

    expect(spawn).toHaveBeenCalledTimes(1);
    const args = spawn.mock.calls[0][1] as {
      impactPoint: { x: number; y: number; z: number };
    };
    const snapshotZ = FP.ToFloat(args.impactPoint.z);
    expect(snapshotZ).toBeCloseTo(50, 3);

    // Move the target far away; the already-snapshotted impact must not change.
    const targetTransform = target.getComponent<TransformComponent>(
      ComponentType.Transform
    )!;
    targetTransform.fpPosition = FPVector3.FromFloat(0, 0, 999);
    expect(FP.ToFloat(args.impactPoint.z)).toBeCloseTo(snapshotZ, 3);
  });

  it('refuses to fire on enemies inside the minimum engagement range', () => {
    const caster = addTransformUnit(entityManager, { x: 0, y: 0, z: 0 }, 0);
    const near = addTransformUnit(
      entityManager,
      { x: 0, y: 0, z: SAU_MIN_ENGAGEMENT_RANGE - 5 },
      1
    );
    fireAt(near, caster);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('fires on enemies beyond the minimum engagement range', () => {
    const caster = addTransformUnit(entityManager, { x: 0, y: 0, z: 0 }, 0);
    const far = addTransformUnit(
      entityManager,
      { x: 0, y: 0, z: SAU_MIN_ENGAGEMENT_RANGE + 20 },
      1
    );
    fireAt(far, caster);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe('ArtilleryShellSystem shrapnel determinism', () => {
  afterEach(() => {
    SoAComponent.resetContext();
  });

  function runDetonation(seed: number): Array<[number, number, number]> {
    const entityManager = makeManager();
    const context = new SystemContext(new EventBus(), entityManager);
    context.random = new DeterministicRandom(seed);
    const impulses: Array<[number, number, number]> = [];
    let nextId = 5000;
    context.physics = {
      spatialGrid: { queryRadius: () => [] as number[] },
      getEntityPosition: () => undefined,
      applyImpulse3D: (_id: number, vx: number, vy: number, vz: number) => {
        impulses.push([FP.ToRaw(vx), FP.ToRaw(vy), FP.ToRaw(vz)]);
      },
    } as never;
    context.abilities = { applyEffect: vi.fn() } as never;
    context.pools = {
      spawn: () => ({ id: nextId++ }),
      despawn: vi.fn(),
    } as never;

    const shellEntity = new Entity();
    const shell = new ArtilleryShellComponent();
    shell.sourceEntityId = 1;
    shell.teamId = 0;
    shell.detonateTick = 0;
    shell.primaryRadius = FP._0;
    shell.secondaryRadius = FP.FromFloat(5);
    shell.shrapnelConfig = {
      count: SAU_SHRAPNEL_COUNT,
      cone: FP.FromFloat(SAU_SHRAPNEL_CONE),
      speed: FP.FromFloat(SAU_SHRAPNEL_SPEED),
    };
    shellEntity.addComponent(shell);
    entityManager.addEntity(shellEntity);
    entityManager.onComponentAdded(shellEntity, ComponentType.ArtilleryShell);

    const system = new ArtilleryShellSystem();
    system.init(context);
    system.processTick(0);
    return impulses;
  }

  it('spawns SAU_SHRAPNEL_COUNT fragments', () => {
    const impulses = runDetonation(42);
    expect(impulses).toHaveLength(SAU_SHRAPNEL_COUNT);
  });

  it('produces identical impulses for the same seed', () => {
    const a = runDetonation(1234);
    const b = runDetonation(1234);
    expect(b).toEqual(a);
  });
});

describe('ShrapnelLandingSystem secondary blast', () => {
  let entityManager: EntityManager;
  let context: SystemContext;
  let applyEffect: ReturnType<typeof vi.fn>;
  let queryRadius: ReturnType<typeof vi.fn>;
  let despawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    entityManager = makeManager();
    context = new SystemContext(new EventBus(), entityManager);
    applyEffect = vi.fn();
    despawn = vi.fn();
    queryRadius = vi.fn();
    context.abilities = { applyEffect } as never;
    context.pools = { despawn, spawn: vi.fn() } as never;
  });

  afterEach(() => {
    SoAComponent.resetContext();
  });

  function addShrapnel(sourceEntityId: number): Entity {
    const entity = new Entity();
    // Current position is below ground (crossed this tick).
    entity.addComponent(
      new TransformComponent(entity.id, FPVector3.FromFloat(2, -1, 3))
    );
    const payload = new ShrapnelPayloadComponent();
    payload.sourceEntityId = sourceEntityId;
    payload.teamId = 0;
    payload.secondaryEffectId = 'Effect.Damage.SAU.Secondary';
    payload.secondaryRadius = FP.FromFloat(5);
    payload.prevPosX = FP.FromFloat(2);
    payload.prevPosY = FP.FromFloat(5);
    payload.prevPosZ = FP.FromFloat(3);
    entity.addComponent(payload);
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, TRANSFORM_COMPONENT_TYPE);
    entityManager.onComponentAdded(entity, ComponentType.ShrapnelPayload);
    return entity;
  }

  function addVictim(): Entity {
    const entity = new Entity();
    const stats = new StatsComponent({ stopRange: 1 });
    stats.alive = true;
    entity.addComponent(stats);
    entity.addComponent(new TeamComponent(1));
    entityManager.addEntity(entity);
    entityManager.onComponentAdded(entity, ComponentType.UnitStats);
    entityManager.onComponentAdded(entity, ComponentType.Team);
    return entity;
  }

  it('applies the secondary effect at the exact ground landing point', () => {
    const victim = addVictim();
    queryRadius.mockReturnValue([victim.id]);
    context.physics = {
      spatialGrid: { queryRadius },
      getEntityPosition: () => ({ x: FP.FromFloat(2), z: FP.FromFloat(3) }),
    } as never;

    const shrapnel = addShrapnel(1);
    const system = new ShrapnelLandingSystem();
    system.init(context);
    system.processTick(0);

    // Queried around the interpolated landing point (≈ x=2, z=3).
    expect(queryRadius).toHaveBeenCalledTimes(1);
    const [qx, qz] = queryRadius.mock.calls[0];
    expect(FP.ToFloat(qx)).toBeCloseTo(2, 3);
    expect(FP.ToFloat(qz)).toBeCloseTo(3, 3);

    expect(applyEffect).toHaveBeenCalledWith(
      victim.id,
      'Effect.Damage.SAU.Secondary',
      1
    );
    const payload = shrapnel.getComponent<ShrapnelPayloadComponent>(
      ComponentType.ShrapnelPayload
    )!;
    expect(payload.landed).toBe(true);
    expect(despawn).toHaveBeenCalledTimes(1);
  });

  it('resolves the secondary even when the firing unit has already died', () => {
    const victim = addVictim();
    queryRadius.mockReturnValue([victim.id]);
    context.physics = {
      spatialGrid: { queryRadius },
      getEntityPosition: () => ({ x: FP.FromFloat(2), z: FP.FromFloat(3) }),
    } as never;

    // Source id 777 has no live entity in the manager (caster is gone).
    addShrapnel(777);
    const system = new ShrapnelLandingSystem();
    system.init(context);
    system.processTick(0);

    expect(applyEffect).toHaveBeenCalledWith(
      victim.id,
      'Effect.Damage.SAU.Secondary',
      777
    );
  });
});
