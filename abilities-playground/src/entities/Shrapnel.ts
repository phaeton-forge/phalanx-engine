import { Entity, type IPoolableEntity } from '@phalanx-engine/ecs';
import { FP, FPQuaternion } from '@phalanx-engine/math';
import type {
  FixedPoint,
  FPVector3 as FPVector3Type,
} from '@phalanx-engine/math';
import {
  InterpolationComponent,
  PhysicsBodyComponent,
  TransformComponent,
} from '@phalanx-engine/physics';
import { TeamComponent } from '../components';
import type { TeamId } from '../components';
import { ShrapnelPayloadComponent } from '../components/ShrapnelPayloadComponent';

/** Physics radius of a shrapnel fragment (small; landing is by ground sweep). */
export const SHRAPNEL_RADIUS = 0.25;

export interface ShrapnelSpawnArgs {
  fpPosition: FPVector3Type;
  /** Full 3D launch velocity (world units/s); applied via applyImpulse3D by the caller. */
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
  private readonly interpolation: InterpolationComponent;
  private readonly transform: TransformComponent;
  private readonly body: PhysicsBodyComponent;
  private readonly payload: ShrapnelPayloadComponent;

  constructor() {
    super();
    this.team = this.addComponent(new TeamComponent(0));
    this.interpolation = this.addComponent(new InterpolationComponent());
    this.transform = this.addComponent(new TransformComponent(this.id));
    this.body = this.addComponent(
      new PhysicsBodyComponent(this.id, {
        radius: FP.FromFloat(SHRAPNEL_RADIUS),
        mass: FP._1,
        friction: FP._1,
        restitution: FP._0,
        useGravity: true,
      })
    );
    this.payload = this.addComponent(new ShrapnelPayloadComponent());
  }

  onSpawn(args: ShrapnelSpawnArgs): void {
    this._active = true;
    this.transform.fpPosition = args.fpPosition;
    this.transform.fpRotation = FPQuaternion.Identity();

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
    this.body.useGravity = true;
    this.body.stopVelocity();

    this.interpolation.capture(args.fpPosition, FPQuaternion.Identity());
    this.interpolation.snapshot();
  }

  onDespawn(): void {
    this._active = false;
  }
}
