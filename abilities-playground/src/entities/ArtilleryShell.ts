import { Entity, type IPoolableEntity } from '@phalanx-engine/ecs';
import type {
  FixedPoint,
  FPVector3 as FPVector3Type,
} from '@phalanx-engine/math';
import { attachTransform, writeFpPosition } from '@phalanx-engine/physics';
import {
  ArtilleryShellComponent,
  type ShrapnelConfig,
} from '../components/ArtilleryShellComponent';
import type { TeamId } from '../components';

export interface ArtilleryShellSpawnArgs {
  impactPoint: FPVector3Type;
  sourceEntityId: number;
  teamId: TeamId;
  detonateTick: number;
  primaryRadius: FixedPoint;
  primaryEffectId: string;
  secondaryRadius: FixedPoint;
  secondaryEffectId: string;
  shrapnelConfig: ShrapnelConfig;
}

/**
 * ArtilleryShellEntity — pooled, logic-only delayed-detonation marker.
 *
 * No PhysicsBody, no mesh: nothing flies. It just carries the snapshotted
 * impact point and blast parameters until ArtilleryShellSystem detonates it at
 * `detonateTick`, then it is returned to the pool.
 */
export class ArtilleryShellEntity
  extends Entity
  implements IPoolableEntity<ArtilleryShellSpawnArgs>
{
  private _active = false;

  public get active() {
    return this._active;
  }

  public set active(value: boolean) {
    this._active = value;
  }

  private readonly shell: ArtilleryShellComponent;

  constructor(id: number) {
    super(id);
    this.shell = this.addComponent(new ArtilleryShellComponent());
    attachTransform(this);
  }

  onSpawn(args: ArtilleryShellSpawnArgs): void {
    this._active = true;
    writeFpPosition(this, args.impactPoint);
    this.shell.impactPoint.x = args.impactPoint.x;
    this.shell.impactPoint.y = args.impactPoint.y;
    this.shell.impactPoint.z = args.impactPoint.z;
    this.shell.sourceEntityId = args.sourceEntityId;
    this.shell.teamId = args.teamId;
    this.shell.detonateTick = args.detonateTick;
    this.shell.primaryRadius = args.primaryRadius;
    this.shell.primaryEffectId = args.primaryEffectId;
    this.shell.secondaryRadius = args.secondaryRadius;
    this.shell.secondaryEffectId = args.secondaryEffectId;
    this.shell.shrapnelConfig = args.shrapnelConfig;
    this.shell.shadowEmitted = false;
  }

  onDespawn(): void {
    this._active = false;
  }
}
