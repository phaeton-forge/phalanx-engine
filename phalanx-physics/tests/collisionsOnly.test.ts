import { describe, expect, it } from 'vitest';
import { Entity, GameSystem, GameWorld } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  PhysicsBody,
  PhysicsEvents,
  PhysicsWorld,
  Transform,
  attachPhysicsBody,
  attachTransform,
  setVelocity,
  type CollisionEvent,
} from '../src/index.js';
import { manualTickProvider } from './support/manualTickProvider.js';

interface BodyPlan {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly mass: number;
  readonly isStatic?: boolean;
  readonly vx?: number;
  readonly vz?: number;
}

const PLANS: readonly BodyPlan[] = [
  { id: 1, x: 0, z: 0, radius: 1, mass: 1, vx: 2 },
  { id: 2, x: 1.2, z: 0.3, radius: 1, mass: 2 },
  { id: 3, x: 2.1, z: -0.4, radius: 0.8, mass: 1, vz: -1 },
  { id: 4, x: 3, z: 0, radius: 1.5, mass: 1, isStatic: true },
  { id: 5, x: -1.1, z: 0.9, radius: 0.6, mass: 0.5, vx: -3, vz: 1 },
  { id: 6, x: 10, z: 10, radius: 1, mass: 1 },
];

const TICKS = 40;
const CELL = FP.FromInt(4);
const PUSH = FP.FromFloat(12);
const GAME_STEP = FP.FromFloat(0.05);

/** Game-side mover: in collisions-only mode the game moves bodies. */
class MoveRight extends GameSystem {
  public override processTick(): void {
    const transforms = this.entityManager.getOrCreateSoAStore(Transform.schema);
    const bodies = this.entityManager.getOrCreateSoAStore(PhysicsBody.schema);
    const posX = transforms.arrays.fpPositionX;
    for (const id of transforms.entityIds()) {
      const b = bodies.indexOf(id);
      if (b === -1 || bodies.arrays.isStatic[b] === 1) continue;
      const t = transforms.indexOf(id);
      posX[t] = FP.ToRaw(FP.Add(FP.FromRaw(posX[t] ?? 0n), GAME_STEP));
    }
  }
}

type Filter = (a: number, b: number) => boolean;

interface Run {
  readonly world: GameWorld;
  readonly events: string[];
}

function populate(world: GameWorld): void {
  for (const plan of PLANS) {
    const entity = world.createEntityWithId(plan.id, (id) => {
      const e = new Entity(id);
      attachTransform(e, {
        x: FP.FromFloat(plan.x),
        y: FP._0,
        z: FP.FromFloat(plan.z),
      });
      attachPhysicsBody(e, {
        radius: FP.FromFloat(plan.radius),
        mass: FP.FromFloat(plan.mass),
        restitution: FP.FromFloat(0.5),
        friction: FP.FromFloat(0.3),
        isStatic: plan.isStatic,
      });
      return e;
    });
    setVelocity(
      entity,
      FP.FromFloat(plan.vx ?? 0),
      FP._0,
      FP.FromFloat(plan.vz ?? 0)
    );
  }
}

function recordEvents(world: GameWorld): string[] {
  const events: string[] = [];
  world.eventBus.on<CollisionEvent>(PhysicsEvents.COLLISION, (event) => {
    const m = event.manifold;
    events.push(
      [
        event.entityA,
        event.entityB,
        FP.ToRaw(m.penetration),
        FP.ToRaw(m.normalX),
        FP.ToRaw(m.normalZ),
      ].join(',')
    );
  });
  return events;
}

function collisionsOnlyRun(filter?: Filter): Run {
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
  const physics = new PhysicsWorld({
    integrate: false,
    collisionResponse: 'push',
    gridCellSize: CELL,
    pushStrength: PUSH,
    // Ignored in collisions-only mode.
    subSteps: 3,
    maxVelocity: FP.FromFloat(0.5),
    worldBounds: {
      minX: FP.FromInt(-1),
      minZ: FP.FromInt(-1),
      maxX: FP.FromInt(1),
      maxZ: FP.FromInt(1),
    },
  });
  physics.attach(world);
  if (filter) physics.setCollisionFilter(filter);
  world.registerSystems(
    [new MoveRight(), physics.getSystems().physicsSystem],
    []
  );
  populate(world);
  return { world, events: recordEvents(world) };
}

function state(world: GameWorld): string[] {
  const transforms = world.entityManager.getOrCreateSoAStore(Transform.schema);
  const bodies = world.entityManager.getOrCreateSoAStore(PhysicsBody.schema);
  const rows: string[] = [];
  for (const id of transforms.entityIds()) {
    const t = transforms.indexOf(id);
    const b = bodies.indexOf(id);
    rows.push(
      [
        id,
        transforms.arrays.fpPositionX[t],
        transforms.arrays.fpPositionY[t],
        transforms.arrays.fpPositionZ[t],
        bodies.arrays.velocityX[b],
        bodies.arrays.velocityY[b],
        bodies.arrays.velocityZ[b],
      ].join(',')
    );
  }
  return rows;
}

/** Positions, velocities and events after every tick, hashed. */
function traceDigest(run: Run): { digest: string; lines: number } {
  const trace: string[] = [];
  for (let tick = 1; tick <= TICKS; tick += 1) {
    run.world.processAllTicks(tick);
    trace.push(...state(run.world), ...run.events.splice(0));
  }
  const text = trace.join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return { digest: hash.toString(16), lines: trace.length };
}

/**
 * The digests were recorded from the removed `CollisionSystem` running the
 * same scene (`CollisionSystem(CELL, PUSH)` after `MoveRight`). They pin
 * `integrate: false` + `'push'` to its state after every tick.
 */
describe('integrate: false (collisions-only)', () => {
  it('matches the former CollisionSystem after every tick', () => {
    expect(traceDigest(collisionsOnlyRun())).toEqual({
      digest: '65554957',
      lines: 384,
    });
  });

  it('matches the former CollisionSystem with a collision filter', () => {
    const filter: Filter = (a, b) => a + b !== 3;
    expect(traceDigest(collisionsOnlyRun(filter))).toEqual({
      digest: 'a0953c20',
      lines: 394,
    });
  });

  it('does not integrate velocity into position', () => {
    const run = collisionsOnlyRun();
    const far = run.world.entityManager.getEntity(6);
    if (far === undefined) throw new Error('missing entity 6');
    setVelocity(far, FP.FromInt(5), FP._0, FP.FromInt(5));
    run.world.processAllTicks(1);
    const transforms = run.world.entityManager.getOrCreateSoAStore(
      Transform.schema
    );
    const index = transforms.indexOf(6);
    expect(
      FP.Eq(
        FP.FromRaw(transforms.arrays.fpPositionX[index] ?? 0n),
        FP.Add(FP.FromInt(10), GAME_STEP)
      )
    ).toBe(true);
    expect(
      FP.Eq(
        FP.FromRaw(transforms.arrays.fpPositionZ[index] ?? 0n),
        FP.FromInt(10)
      )
    ).toBe(true);
  });
});
