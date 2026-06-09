import { Entity, type IPoolable } from 'phalanx-ecs';
import { FP, FPVector3 } from 'phalanx-math';
import {
  InterpolationComponent,
  PhysicsBodyComponent,
  TransformComponent,
} from 'phalanx-physics';
import {
  ComponentType,
  MeshComponent,
  TeamComponent,
} from '../components';
import { ProjectileComponent } from '../components/ProjectileComponent.ts';

export const PROJECTILE_RADIUS = 0.5;
const PROJECTILE_MASS = 1;

export class ProjectileEntity extends Entity implements IPoolable {
  private _active = false;

  public get active() {
    return this._active;
  }

  public set active(value: boolean) {
    this._active = value;
  }

  reinitialize() {
    this._active = true;

    this.getComponent<MeshComponent>(ComponentType.Mesh)!.reinitialize();

    const fpPosition = FPVector3.FromFloat(0, 0, 0);

    this.addComponent(new ProjectileComponent());
    this.addComponent(new TransformComponent(this.id, fpPosition));
    this.addComponent(new TeamComponent(0));
    this.addComponent(new InterpolationComponent(fpPosition));
    this.addComponent(
      new PhysicsBodyComponent(this.id, {
        radius: FP.FromFloat(PROJECTILE_RADIUS),
        mass: FP.FromFloat(PROJECTILE_MASS),
        friction: FP.FromFloat(0.15),
        restitution: FP.FromFloat(0.05),
      }),
    );
  }

  reset() {
    super.reset();
    this._active = false;
  }
}
