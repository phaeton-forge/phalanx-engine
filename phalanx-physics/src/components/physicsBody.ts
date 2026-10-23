import { defineComponent } from '@phalanx-engine/ecs';
import type { Entity, SoAComponentStore } from '@phalanx-engine/ecs';
import {
  FP,
  type FixedPoint,
  type FPVector3 as FPVector3Type,
} from '@phalanx-engine/math';
import type { PhysicsBodyConfig } from '../types.js';

const RAW_0 = FP.ToRaw(FP._0);
const RAW_1 = FP.ToRaw(FP._1);
const DEFAULT_RESTITUTION = FP.FromFloat(0.5);
const RAW_RESTITUTION = FP.ToRaw(DEFAULT_RESTITUTION);
const DEFAULT_FRICTION_FALLBACK = FP.FromFloat(0.3);

/**
 * Saved physics state. `f64` display caches are gone: rendering reads
 * `Transform` and `Interpolation`.
 */
export const PhysicsBody = defineComponent(
  'PhysicsBody',
  {
    velocityX: 'i64',
    velocityY: 'i64',
    velocityZ: 'i64',
    radius: 'i64',
    mass: 'i64',
    restitution: 'i64',
    friction: 'i64',
    isStatic: 'u8',
    ignorePhysics: 'u8',
    useGravity: 'u8',
    gravityMultiplier: 'i64',
  },
  {
    defaults: {
      mass: RAW_1,
      restitution: RAW_RESTITUTION,
      friction: RAW_0,
      gravityMultiplier: RAW_1,
    },
  }
);

export const PhysicsSoASchema = PhysicsBody.schema;

type BodyStore = SoAComponentStore<typeof PhysicsSoASchema.definition>;

const VELOCITY: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

function store(entity: Entity): BodyStore {
  const manager = entity._owner;
  if (manager === null) {
    throw new Error(
      `PhysicsBody: entity ${String(entity.id)} is not in a world`
    );
  }
  const found = manager.getSoAStore(PhysicsSoASchema);
  if (found === undefined) {
    throw new Error('PhysicsBody: store is not created');
  }
  return found;
}

function rawAt(values: BigInt64Array, index: number): bigint {
  const value = values[index];
  return value === undefined ? RAW_0 : value;
}

function flagAt(values: Uint8Array, index: number): number {
  const value = values[index];
  return value === undefined ? 0 : value;
}

/** Attach a body row. Safe before the entity is registered. */
export function attachPhysicsBody(
  entity: Entity,
  config: PhysicsBodyConfig
): void {
  entity.addComponent(PhysicsBody.create(entity.id, bodyValues(config)));
}

export function bodyValues(
  config: PhysicsBodyConfig
): Partial<typeof PhysicsBody.defaults> {
  const mass = config.mass ?? FP._1;
  const restitution = config.restitution ?? DEFAULT_RESTITUTION;
  const friction = config.friction ?? FP._0;
  const gravityMultiplier = config.gravityMultiplier ?? FP._1;
  return {
    velocityX: RAW_0,
    velocityY: RAW_0,
    velocityZ: RAW_0,
    radius: FP.ToRaw(config.radius),
    mass: FP.ToRaw(mass),
    restitution: FP.ToRaw(restitution),
    friction: FP.ToRaw(friction),
    isStatic: config.isStatic === true ? 1 : 0,
    ignorePhysics: 0,
    useGravity: config.useGravity === true ? 1 : 0,
    gravityMultiplier: FP.ToRaw(gravityMultiplier),
  };
}

/** Shared scratch. Do not retain it across another velocity read. */
export function readVelocity(entity: Entity): FPVector3Type {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return VELOCITY;
  const arrays = store(entity).arrays;
  VELOCITY.x = FP.FromRaw(rawAt(arrays.velocityX, index));
  VELOCITY.y = FP.FromRaw(rawAt(arrays.velocityY, index));
  VELOCITY.z = FP.FromRaw(rawAt(arrays.velocityZ, index));
  return VELOCITY;
}

export function writeVelocity(entity: Entity, value: FPVector3Type): void {
  setVelocity(entity, value.x, value.y, value.z);
}

export function setVelocity(
  entity: Entity,
  x: FixedPoint,
  y: FixedPoint,
  z: FixedPoint
): void {
  const arrays = store(entity).arrays;
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return;
  arrays.velocityX[index] = FP.ToRaw(x);
  arrays.velocityY[index] = FP.ToRaw(y);
  arrays.velocityZ[index] = FP.ToRaw(z);
}

export function addVelocity(entity: Entity, velocity: FPVector3Type): void {
  const arrays = store(entity).arrays;
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return;
  const currentX = FP.FromRaw(rawAt(arrays.velocityX, index));
  const currentY = FP.FromRaw(rawAt(arrays.velocityY, index));
  const currentZ = FP.FromRaw(rawAt(arrays.velocityZ, index));
  arrays.velocityX[index] = FP.ToRaw(FP.Add(currentX, velocity.x));
  arrays.velocityY[index] = FP.ToRaw(FP.Add(currentY, velocity.y));
  arrays.velocityZ[index] = FP.ToRaw(FP.Add(currentZ, velocity.z));
}

export function stopVelocity(entity: Entity): void {
  const arrays = store(entity).arrays;
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return;
  arrays.velocityX[index] = RAW_0;
  arrays.velocityY[index] = RAW_0;
  arrays.velocityZ[index] = RAW_0;
}

export function readRadius(entity: Entity): FixedPoint {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return FP._1;
  return FP.FromRaw(rawAt(store(entity).arrays.radius, index));
}

export function readMass(entity: Entity): FixedPoint {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return FP._1;
  return FP.FromRaw(rawAt(store(entity).arrays.mass, index));
}

export function readRestitution(entity: Entity): FixedPoint {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return DEFAULT_RESTITUTION;
  return FP.FromRaw(rawAt(store(entity).arrays.restitution, index));
}

export function readFriction(entity: Entity): FixedPoint {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return DEFAULT_FRICTION_FALLBACK;
  return FP.FromRaw(rawAt(store(entity).arrays.friction, index));
}

export function readIsStatic(entity: Entity): boolean {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return false;
  return flagAt(store(entity).arrays.isStatic, index) === 1;
}

export function readIgnorePhysics(entity: Entity): boolean {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return false;
  return flagAt(store(entity).arrays.ignorePhysics, index) === 1;
}

export function writeIgnorePhysics(entity: Entity, value: boolean): void {
  writeFlag(entity, 'ignorePhysics', value);
}

export function readUseGravity(entity: Entity): boolean {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return false;
  return flagAt(store(entity).arrays.useGravity, index) === 1;
}

export function writeUseGravity(entity: Entity, value: boolean): void {
  writeFlag(entity, 'useGravity', value);
}

export function readGravityMultiplier(entity: Entity): FixedPoint {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return FP._1;
  return FP.FromRaw(rawAt(store(entity).arrays.gravityMultiplier, index));
}

export function writeGravityMultiplier(
  entity: Entity,
  value: FixedPoint
): void {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return;
  store(entity).arrays.gravityMultiplier[index] = FP.ToRaw(value);
}

function writeFlag(
  entity: Entity,
  field: 'ignorePhysics' | 'useGravity',
  value: boolean
): void {
  const index = store(entity).indexOf(entity.id);
  if (index === -1) return;
  store(entity).arrays[field][index] = value ? 1 : 0;
}
