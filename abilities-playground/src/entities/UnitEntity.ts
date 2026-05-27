import { Entity } from 'phalanx-ecs';
import type * as THREE from 'three';
import { FP, FPVector3 } from 'phalanx-math';
import { PhysicsBodyComponent } from 'phalanx-physics';
import {
  ConeBeamComponent,
  HealerAuraLinkComponent,
  HealthBarComponent,
  InterpolationComponent,
  MeshComponent,
  TargetStateComponent,
  TeamComponent,
  TransformComponent,
  StatsComponent,
  UnitTypeComponent,
} from '../components';
import type { TeamId } from '../components';
import type { UnitRosterEntry } from '../config/unitRoster';

export class UnitEntity extends Entity {
  constructor(
    rosterEntry: UnitRosterEntry,
    teamId: TeamId,
    position: { x: number; y: number; z: number },
    renderRefs: {
      root: THREE.Object3D;
      healthBarRoot: THREE.Object3D;
      healthBarFill: THREE.Object3D;
      healthBarFullWidth: number;
    },
  ) {
    super();

    const fpPosition = FPVector3.FromFloat(position.x, position.y, position.z);

    this.addComponent(new TransformComponent(this.id, fpPosition));
    this.addComponent(new TeamComponent(teamId));
    this.addComponent(new UnitTypeComponent(rosterEntry.kind));
    this.addComponent(new StatsComponent({ stopRange: rosterEntry.stopRange }));
    this.addComponent(new TargetStateComponent());
    this.addComponent(new MeshComponent(renderRefs.root));
    this.addComponent(
      new HealthBarComponent(
        renderRefs.healthBarRoot,
        renderRefs.healthBarFill,
        renderRefs.healthBarFullWidth,
      ),
    );

    const interpCmp = new InterpolationComponent();

    interpCmp.init(fpPosition);

    this.addComponent(interpCmp);
    this.addComponent(
      new PhysicsBodyComponent(this.id, {
        radius: FP.FromFloat(rosterEntry.radius),
        mass: FP.FromFloat(rosterEntry.mass),
        friction: FP.FromFloat(0.15),
        restitution: FP.FromFloat(0.05),
      }),
    );

    if (rosterEntry.kind === 'cube') {
      this.addComponent(new HealerAuraLinkComponent());
    }
    if (rosterEntry.kind === 'cone') {
      this.addComponent(new ConeBeamComponent());
    }
  }
}
