import { Entity, type IPoolableEntity } from '@phalanx-engine/ecs';
import { FP, FPQuaternion } from '@phalanx-engine/math';
import type {
  FixedPoint,
  FPVector3 as FPVector3Type,
} from '@phalanx-engine/math';
import {
  attachInterpolation,
  attachPhysicsBody,
  attachTransform,
  stopVelocity,
  writeFpPosition,
  writeFpRotation,
  writeUseGravity,
} from '@phalanx-engine/physics';
import { MeshComponent, TeamComponent } from '../components';
import type { TeamId } from '../components';
import {
  SHRAPNEL_GRAVITY_MULTIPLIER,
  SHRAPNEL_MASS,
} from '../config/constants';
import { ShrapnelPayloadComponent } from '../components/ShrapnelPayloadComponent';

/** Physics radius of a shrapnel fragment (small; landing is by ground sweep). */
export const SHRAPNEL_RADIUS = 0.7;

/** Visual size (world units) of the shared shard mesh. */
export const SHRAPNEL_VISUAL_RADIUS = 0.8;

export interface ShrapnelSpawnArgs {
  fpPosition: FPVector3Type;
  /** Full 3D launch impulse (world units·kg/s); applied via applyImpulse3D by the caller. */
  sourceEntityId: number;
  teamId: TeamId;
  secondaryEffectId: string;
  secondaryRadius: FixedPoint;
}

/**
 * ShrapnelEntity — pooled gravity-affected fragment sprayed on shell detonation.
 *
 * Has a real PhysicsBody with useGravity=true so the global GravitySystem arcs
 * it back to the ground. friction=FP._1 keeps horizontal drift tight. It is NOT
 * ignorePhysics — it stays in the pipeline but is excluded from unit/shrapnel
 * collisions by the collision filter, so it never shoves units around.
 */
export class ShrapnelEntity
  extends Entity
  implements IPoolableEntity<ShrapnelSpawnArgs>
{
  private _active = false;

  public get active() {
    return this._active;
  }

  public set active(value: boolean) {
    this._active = value;
  }

  private readonly team: TeamComponent;
  private readonly payload: ShrapnelPayloadComponent;
  constructor(id: number) {
    super(id);
    this.team = this.addComponent(new TeamComponent(0));
    this.addComponent(MeshComponent.createShrapnel(SHRAPNEL_VISUAL_RADIUS));
    attachInterpolation(this);
    attachTransform(this);
    attachPhysicsBody(this, {
      radius: FP.FromFloat(SHRAPNEL_RADIUS),
      mass: FP.FromFloat(SHRAPNEL_MASS),
      friction: FP._1,
      restitution: FP._0,
      useGravity: true,
      gravityMultiplier: FP.FromFloat(SHRAPNEL_GRAVITY_MULTIPLIER),
    });
    this.payload = this.addComponent(new ShrapnelPayloadComponent());
  }

  onSpawn(args: ShrapnelSpawnArgs): void {
    this._active = true;
    writeFpPosition(this.id, args.fpPosition);
    writeFpRotation(this.id, FPQuaternion.Identity());

    this.team.teamId = args.teamId;
    this.payload.sourceEntityId = args.sourceEntityId;
    this.payload.teamId = args.teamId;
    this.payload.secondaryEffectId = args.secondaryEffectId;
    this.payload.secondaryRadius = args.secondaryRadius;
    this.payload.prevPosX = args.fpPosition.x;
    this.payload.prevPosY = args.fpPosition.y;
    this.payload.prevPosZ = args.fpPosition.z;
    this.payload.landed = false;

    // Fragments spawn with gravity on and velocity zeroed; the caller applies
    // the cone impulse via PhysicsWorld.applyImpulse3D right after spawn.
    writeUseGravity(this.id, true);
    stopVelocity(this.id);
    attachInterpolation(this, args.fpPosition, FPQuaternion.Identity());
  }

  onDespawn(): void {
    this._active = false;
  }
}
