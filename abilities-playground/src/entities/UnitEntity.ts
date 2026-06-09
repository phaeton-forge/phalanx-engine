import { Entity } from 'phalanx-ecs';
import { FP, FPVector3 } from 'phalanx-math';
import { PhysicsBodyComponent } from 'phalanx-physics';
import {
  HealthBarComponent,
  InterpolationComponent,
  MeshComponent,
  SpawnPointComponent,
  TargetStateComponent,
  TeamComponent,
  TransformComponent,
  StatsComponent,
  UnitTypeComponent,
  DetectionRingComponent,
} from '../components';
import type { TeamId } from '../components';
import type { UnitRosterEntry } from '../config/unitRoster';
import { DEFAULT_UNIT_DETECTION_RANGE } from '../config/unitRoster';
import type { UnitRenderRefs } from '../core/UnitFactory';

export class UnitEntity extends Entity {
  constructor(
    rosterEntry: UnitRosterEntry,
    teamId: TeamId,
    position: { x: number; y: number; z: number },
    renderRefs: UnitRenderRefs,
  ) {
    super();

    const fpPosition = FPVector3.FromFloat(position.x, position.y, position.z);
    const detectionRange =
      rosterEntry.detectionRange ?? DEFAULT_UNIT_DETECTION_RANGE;

    const initialRotationY = teamId === 0 ? 0 : Math.PI;
    this.addComponent(new TransformComponent(this.id, fpPosition, initialRotationY));
    this.addComponent(new TeamComponent(teamId));
    this.addComponent(
      new UnitTypeComponent(rosterEntry.kind, FP.FromFloat(detectionRange)),
    );
    this.addComponent(new StatsComponent({ stopRange: rosterEntry.stopRange }));
    this.addComponent(new TargetStateComponent());
    this.addComponent(new MeshComponent(renderRefs.root));
    this.addComponent(new DetectionRingComponent(renderRefs.detectionRing));
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

    if (renderRefs.spawnPoint) {
      this.addComponent(new SpawnPointComponent(renderRefs.spawnPoint.marker));
    }
  }
}
