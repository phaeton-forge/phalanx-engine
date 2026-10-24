import {
  GameWorld,
  type GameSystem,
  type EntityManager,
  type EventBus,
  type SoAComponentStore,
  type SystemContext,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { Interpolation } from '../../src/components/interpolation.js';
import { PhysicsBody } from '../../src/components/physicsBody.js';
import { Transform } from '../../src/components/transform.js';
import { PhysicsWorld } from '../../src/PhysicsWorld.js';
import type { PhysicsWorldConfig } from '../../src/PhysicsWorldConfig.js';
import { GravitySystem } from '../../src/systems/GravitySystem.js';
import { InterpolationSystem } from '../../src/systems/InterpolationSystem.js';
import { PhysicsSystem } from '../../src/systems/PhysicsSystem.js';
import { manualTickProvider } from './manualTickProvider.js';

export interface PhysicsTestWorld {
  readonly world: GameWorld;
  readonly entityManager: EntityManager;
  readonly eventBus: EventBus;
  readonly context: SystemContext;
}

type BodyStore = SoAComponentStore<typeof PhysicsBody.schema.definition>;
type TransformStore = SoAComponentStore<typeof Transform.schema.definition>;

const owners = new WeakMap<object, GameWorld>();

function ownStores(world: GameWorld): void {
  owners.set(world.entityManager.getOrCreateSoAStore(Transform.schema), world);
  owners.set(
    world.entityManager.getOrCreateSoAStore(PhysicsBody.schema),
    world
  );
}

/**
 * A world with the physics components registered, for driving systems by
 * hand (`system.init(context)`, `system.processTick`). Bodies are real
 * entities: physics systems iterate with `world.query`.
 */
export function physicsTestWorld(): PhysicsTestWorld {
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
  world.registerComponent(Transform);
  world.registerComponent(PhysicsBody);
  world.registerComponent(Interpolation);
  ownStores(world);
  return {
    world,
    entityManager: world.entityManager,
    eventBus: world.eventBus,
    context: world.context,
  };
}

function entityFor(
  store: object,
  entityId: number
): {
  world: GameWorld;
  entity: ReturnType<GameWorld['createEntityWithId']>;
} {
  const world = owners.get(store);
  if (world === undefined) {
    throw new Error('store does not belong to a physicsTestWorld');
  }
  const entity =
    world.entityManager.getEntity(entityId) ??
    world.createEntityWithId(entityId);
  return { world, entity };
}

/** Give entity `entityId` a `PhysicsBody` row with `values`. */
export function addBodyRow(
  store: BodyStore,
  entityId: number,
  values: Partial<typeof PhysicsBody.defaults>
): void {
  const { world, entity } = entityFor(store, entityId);
  world.addComponent(entity, PhysicsBody, values);
}

/** Give entity `entityId` a `Transform` row with zero rotation. */
export function addTransformRow(
  store: TransformStore,
  entityId: number,
  posX: number,
  posZ: number,
  posY = 0
): void {
  const { world, entity } = entityFor(store, entityId);
  world.addComponent(entity, Transform, {
    fpPositionX: FP.ToRaw(FP.FromFloat(posX)),
    fpPositionY: FP.ToRaw(FP.FromFloat(posY)),
    fpPositionZ: FP.ToRaw(FP.FromFloat(posZ)),
    fpRotationX: FP.ToRaw(FP._0),
    fpRotationY: FP.ToRaw(FP._0),
    fpRotationZ: FP.ToRaw(FP._0),
    fpRotationW: FP.ToRaw(FP._1),
  });
}

export interface AttachedPhysics {
  readonly world: GameWorld;
  readonly physics: PhysicsWorld;
  readonly physicsSystem: PhysicsSystem;
  readonly gravitySystem: GravitySystem;
  readonly interpolationSystem: InterpolationSystem;
}

function requireSystem<T>(system: T | undefined, name: string): T {
  if (system === undefined) throw new Error(`attach did not add ${name}`);
  return system;
}

/**
 * `PhysicsWorld.attach` on a fresh world, then `registerSystems`. The
 * attached systems are initialized and found with `world.getSystem`.
 */
export function attachedPhysics(
  config?: PhysicsWorldConfig,
  tickSystems: GameSystem[] = []
): AttachedPhysics {
  const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
  const physics = new PhysicsWorld(config);
  physics.attach(world);
  ownStores(world);
  world.registerSystems(tickSystems, []);
  return {
    world,
    physics,
    physicsSystem: requireSystem(
      world.getSystem(PhysicsSystem),
      'PhysicsSystem'
    ),
    gravitySystem: requireSystem(
      world.getSystem(GravitySystem),
      'GravitySystem'
    ),
    interpolationSystem: requireSystem(
      world.getSystem(InterpolationSystem),
      'InterpolationSystem'
    ),
  };
}
