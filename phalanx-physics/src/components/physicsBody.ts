import { defineComponent, SoAComponent } from '@phalanx-engine/ecs';
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
export const PHYSICS_BODY_COMPONENT_TYPE: symbol = PhysicsBody.type;

type BodyStore = SoAComponentStore<typeof PhysicsSoASchema.definition>;

const VELOCITY: FPVector3Type = { x: FP._0, y: FP._0, z: FP._0 };

function store(): BodyStore {
  const manager = SoAComponent.currentEntityManager();
  if (manager === null) {
    throw new Error('PhysicsBody: no EntityManager context');
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
export function readVelocity(entityId: number): FPVector3Type {
  const index = store().indexOf(entityId);
  if (index === -1) return VELOCITY;
  const arrays = store().arrays;
  VELOCITY.x = FP.FromRaw(rawAt(arrays.velocityX, index));
  VELOCITY.y = FP.FromRaw(rawAt(arrays.velocityY, index));
  VELOCITY.z = FP.FromRaw(rawAt(arrays.velocityZ, index));
  return VELOCITY;
}

export function writeVelocity(entityId: number, value: FPVector3Type): void {
  setVelocity(entityId, value.x, value.y, value.z);
}

export function setVelocity(
  entityId: number,
  x: FixedPoint,
  y: FixedPoint,
  z: FixedPoint
): void {
  const arrays = store().arrays;
  const index = store().indexOf(entityId);
  if (index === -1) return;
  arrays.velocityX[index] = FP.ToRaw(x);
  arrays.velocityY[index] = FP.ToRaw(y);
  arrays.velocityZ[index] = FP.ToRaw(z);
}

export function addVelocity(entityId: number, velocity: FPVector3Type): void {
  const arrays = store().arrays;
  const index = store().indexOf(entityId);
  if (index === -1) return;
  const currentX = FP.FromRaw(rawAt(arrays.velocityX, index));
  const currentY = FP.FromRaw(rawAt(arrays.velocityY, index));
  const currentZ = FP.FromRaw(rawAt(arrays.velocityZ, index));
  arrays.velocityX[index] = FP.ToRaw(FP.Add(currentX, velocity.x));
  arrays.velocityY[index] = FP.ToRaw(FP.Add(currentY, velocity.y));
  arrays.velocityZ[index] = FP.ToRaw(FP.Add(currentZ, velocity.z));
}

export function stopVelocity(entityId: number): void {
  const arrays = store().arrays;
  const index = store().indexOf(entityId);
  if (index === -1) return;
  arrays.velocityX[index] = RAW_0;
  arrays.velocityY[index] = RAW_0;
  arrays.velocityZ[index] = RAW_0;
}

export function readRadius(entityId: number): FixedPoint {
  const index = store().indexOf(entityId);
  if (index === -1) return FP._1;
  return FP.FromRaw(rawAt(store().arrays.radius, index));
}

export function readMass(entityId: number): FixedPoint {
  const index = store().indexOf(entityId);
  if (index === -1) return FP._1;
  return FP.FromRaw(rawAt(store().arrays.mass, index));
}

export function readRestitution(entityId: number): FixedPoint {
  const index = store().indexOf(entityId);
  if (index === -1) return DEFAULT_RESTITUTION;
  return FP.FromRaw(rawAt(store().arrays.restitution, index));
}

export function readFriction(entityId: number): FixedPoint {
  const index = store().indexOf(entityId);
  if (index === -1) return DEFAULT_FRICTION_FALLBACK;
  return FP.FromRaw(rawAt(store().arrays.friction, index));
}

export function readIsStatic(entityId: number): boolean {
  const index = store().indexOf(entityId);
  if (index === -1) return false;
  return flagAt(store().arrays.isStatic, index) === 1;
}

export function readIgnorePhysics(entityId: number): boolean {
  const index = store().indexOf(entityId);
  if (index === -1) return false;
  return flagAt(store().arrays.ignorePhysics, index) === 1;
}

export function writeIgnorePhysics(entityId: number, value: boolean): void {
  writeFlag(entityId, 'ignorePhysics', value);
}

export function readUseGravity(entityId: number): boolean {
  const index = store().indexOf(entityId);
  if (index === -1) return false;
  return flagAt(store().arrays.useGravity, index) === 1;
}

export function writeUseGravity(entityId: number, value: boolean): void {
  writeFlag(entityId, 'useGravity', value);
}

export function readGravityMultiplier(entityId: number): FixedPoint {
  const index = store().indexOf(entityId);
  if (index === -1) return FP._1;
  return FP.FromRaw(rawAt(store().arrays.gravityMultiplier, index));
}

export function writeGravityMultiplier(
  entityId: number,
  value: FixedPoint
): void {
  const index = store().indexOf(entityId);
  if (index === -1) return;
  store().arrays.gravityMultiplier[index] = FP.ToRaw(value);
}

function writeFlag(
  entityId: number,
  field: 'ignorePhysics' | 'useGravity',
  value: boolean
): void {
  const index = store().indexOf(entityId);
  if (index === -1) return;
  store().arrays[field][index] = value ? 1 : 0;
}
