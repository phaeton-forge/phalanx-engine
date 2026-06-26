import { Entity, type IPoolableEntity } from '@phalanx-engine/ecs';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import type {
  FPVector3 as FPVector3Type,
  FPQuaternion as FPQuaternionType,
} from '@phalanx-engine/math';
import {
  InterpolationComponent,
  PhysicsBodyComponent,
  TransformComponent,
} from '@phalanx-engine/physics';
import { MeshComponent, TeamComponent } from '../components';
import type { TeamId } from '../components';
import { ProjectileComponent } from '../components/ProjectileComponent';
import {
  MissileComponent,
  MISSILE_DEFAULT_LIFETIME,
} from '../components/MissileComponent';
import {
  MISSILE_LAUNCH_TICKS,
  MISSILE_TARGETING_TICKS,
  MISSILE_RADIUS,
  MISSILE_LAUNCH_HEIGHT,
  MISSILE_LAUNCH_SPREAD_MAX,
} from '../config/constants';

function lcg01(seed: number): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0xffffffff;
}

/** Forward hemisphere in local space: angles in [0, π] keep +Z (forward) ≥ 0. */
function clampForwardHemisphereAngle(angle: number): number {
  return Math.max(0, Math.min(Math.PI, angle));
}

/** Deterministic launch spread so volley missiles fan out instead of stacking. */
function computeLaunchTrajectory(
  entityId: number,
  volleyIndex: number,
  volleyCount: number
): {
  spreadX: ReturnType<typeof FP.FromFloat>;
  spreadZ: ReturnType<typeof FP.FromFloat>;
  heightScale: ReturnType<typeof FP.FromFloat>;
} {
  const maxSpread = FP.FromFloat(MISSILE_LAUNCH_SPREAD_MAX);

  let angle: number;
  if (volleyCount > 1) {
    angle = (Math.PI * volleyIndex) / (volleyCount - 1);
    angle += (lcg01(entityId ^ 0x9e3779b9) - 0.5) * 0.35;
  } else {
    angle = lcg01(entityId ^ 0xdeadbeef) * Math.PI;
  }
  angle = clampForwardHemisphereAngle(angle);

  const spreadMag = FP.Mul(
    maxSpread,
    FP.FromFloat(0.65 + lcg01(entityId ^ 0xbeefcafe) * 0.35)
  );
  const spreadX = FP.Mul(spreadMag, FP.FromFloat(Math.cos(angle)));
  const spreadZ = FP.Mul(spreadMag, FP.FromFloat(Math.sin(angle)));
  const heightScale = FP.FromFloat(0.88 + lcg01(entityId ^ 0xcafebabe) * 0.24);

  return { spreadX, spreadZ, heightScale };
}

export interface MissileSpawnArgs {
  fpPosition: FPVector3Type;
  targetEntityId: number;
  teamId: TeamId;
  /** Index within a simultaneous volley (0-based). */
  volleyIndex?: number;
  /** Total missiles fired in this volley. */
  volleyCount?: number;
  /** Caster rotation; spread is rotated into world space before launch. */
  launcherRotation?: FPQuaternionType;
}

export class MissileEntity
  extends Entity
  implements IPoolableEntity<MissileSpawnArgs>
{
  private _active = false;

  public get active() {
    return this._active;
  }

  public set active(value: boolean) {
    this._active = value;
  }

  private readonly projectile: ProjectileComponent;
  private readonly missile: MissileComponent;
  private readonly team: TeamComponent;
  private readonly interpolation: InterpolationComponent;
  private readonly transform: TransformComponent;

  constructor() {
    super();
    this.addComponent(MeshComponent.createMissile());
    this.projectile = this.addComponent(new ProjectileComponent());
    this.missile = this.addComponent(new MissileComponent());
    this.team = this.addComponent(new TeamComponent(0));
    this.interpolation = this.addComponent(new InterpolationComponent());
    this.transform = this.addComponent(new TransformComponent(this.id));
    this.addComponent(
      new PhysicsBodyComponent(this.id, {
        radius: FP.FromFloat(MISSILE_RADIUS),
        mass: FP.FromFloat(1),
        friction: FP.FromFloat(0.15),
        restitution: FP.FromFloat(0.05),
      })
    );
  }

  onSpawn(args: MissileSpawnArgs): void {
    this._active = true;
    this.transform.fpPosition = args.fpPosition;

    this.projectile.damageEffectId = 'Effect.Damage.Missile';
    this.missile.targetEntityId = args.targetEntityId;
    this.missile.phase = 'launch';
    this.missile.launchTicksRemaining = MISSILE_LAUNCH_TICKS;
    this.missile.approachTicksRemaining = MISSILE_TARGETING_TICKS;
    this.missile.spawnX = args.fpPosition.x;
    this.missile.spawnY = args.fpPosition.y;
    this.missile.spawnZ = args.fpPosition.z;
    this.missile.lifeTime = MISSILE_DEFAULT_LIFETIME;

    const volleyIndex = args.volleyIndex ?? 0;
    const volleyCount = args.volleyCount ?? 1;
    const { spreadX, spreadZ, heightScale } = computeLaunchTrajectory(
      this.id,
      volleyIndex,
      volleyCount
    );
    this.missile.launchHeightScale = heightScale;

    const localSpread = { x: spreadX, y: FP._0, z: spreadZ };
    const worldSpread = args.launcherRotation
      ? FPQuaternion.RotateVector(args.launcherRotation, localSpread)
      : localSpread;
    this.missile.launchSpreadX = worldSpread.x;
    this.missile.launchSpreadZ = worldSpread.z;

    const peakH = FP.Mul(FP.FromFloat(MISSILE_LAUNCH_HEIGHT), heightScale);
    const launchDir = { x: worldSpread.x, y: peakH, z: worldSpread.z };
    const launchQuat = FP.Eq(FPVector3.SqrMagnitude(launchDir), FP._0)
      ? FPQuaternion.FromAxisAngle(FPVector3.Right, FP.Neg(FP.PiOver2))
      : FPQuaternion.LookRotation(launchDir);

    this.transform.fpRotation = launchQuat;
    this.team.teamId = args.teamId;

    this.interpolation.capture(args.fpPosition, launchQuat);
    this.interpolation.snapshot();
  }

  onDespawn(): void {
    this._active = false;
  }
}
