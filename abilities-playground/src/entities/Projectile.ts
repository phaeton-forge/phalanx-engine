import { Entity, type IPoolableEntity } from '@phalanx-engine/ecs';
import { FP, FPQuaternion } from '@phalanx-engine/math';
import type {
  FPVector3 as FPVector3Type,
  FPVector2 as FPVector2Type,
} from '@phalanx-engine/math';
import {
  InterpolationComponent,
  PhysicsBodyComponent,
  TransformComponent,
} from '@phalanx-engine/physics';
import { MeshComponent, TeamComponent } from '../components';
import type { TeamId } from '../components';
import {
  ProjectileComponent,
  PROJECTILE_DEFAULT_LIFETIME,
} from '../components/ProjectileComponent.ts';

export const PROJECTILE_RADIUS = 0.5;
const PROJECTILE_MASS = 1;

export interface ProjectileSpawnArgs {
  fpPosition: FPVector3Type;
  fpDirection2: FPVector2Type;
  teamId: TeamId;
}

export class ProjectileEntity
  extends Entity
  implements IPoolableEntity<ProjectileSpawnArgs>
{
  private _active = false;

  public get active() {
    return this._active;
  }

  public set active(value: boolean) {
    this._active = value;
  }

  // Cached typed references — no getComponent lookups in onSpawn/onDespawn
  private readonly mesh: MeshComponent;
  private readonly projectile: ProjectileComponent;
  private readonly team: TeamComponent;
  private readonly interpolation: InterpolationComponent;
  private readonly transform: TransformComponent;

  constructor() {
    super();
    // Mesh visibility is handled by MeshComponent's own IPoolableComponent hooks.
    this.mesh = this.addComponent(
      MeshComponent.createProjectile(PROJECTILE_RADIUS)
    );
    this.projectile = this.addComponent(new ProjectileComponent());
    this.team = this.addComponent(new TeamComponent(0));
    this.interpolation = this.addComponent(new InterpolationComponent());
    // SoA wrappers: rows are auto-managed by SoAComponent's IPoolableComponent
    // hooks (removed while dormant in the pool, restored to defaults on spawn).
    this.transform = this.addComponent(new TransformComponent(this.id));
    this.addComponent(
      new PhysicsBodyComponent(this.id, {
        radius: FP.FromFloat(PROJECTILE_RADIUS),
        mass: FP.FromFloat(PROJECTILE_MASS),
        friction: FP.FromFloat(0.15),
        restitution: FP.FromFloat(0.05),
      })
    );
  }

  onSpawn(args: ProjectileSpawnArgs): void {
    this._active = true;

    // Per-spawn values via typed setters — SoA rows already restored by the engine.
    this.transform.fpPosition = args.fpPosition;
    this.projectile.fpDirection2.x = args.fpDirection2.x;
    this.projectile.fpDirection2.y = args.fpDirection2.y;
    this.projectile.lifeTime = PROJECTILE_DEFAULT_LIFETIME;
    this.team.teamId = args.teamId;
    this.mesh.applyTeamColor(args.teamId);

    // Align the bolt with travel direction (fpDirection2.y is world Z).
    const rotation = FPQuaternion.LookRotation({
      x: args.fpDirection2.x,
      y: FP._0,
      z: args.fpDirection2.y,
    });
    this.transform.fpRotation = rotation;

    // Snap interpolation so the first frame doesn't blend from a stale pose.
    this.interpolation.capture(args.fpPosition, rotation);
    this.interpolation.snapshot();
  }

  onDespawn(): void {
    this._active = false;
  }
}
