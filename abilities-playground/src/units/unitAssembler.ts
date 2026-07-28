import type { Entity } from '@phalanx-engine/ecs';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import {
  InterpolationComponent,
  PhysicsBodyComponent,
  TransformComponent,
} from '@phalanx-engine/physics';
import {
  TeamComponent,
  UnitTypeComponent,
  StatsComponent,
  TargetStateComponent,
  MeshComponent,
  DetectionRingComponent,
  HealthBarComponent,
  SpawnPointComponent,
  HealAuraComponent,
  CubeStateComponent,
  AutoAttackTimerComponent,
  SupportUnitTargetingComponent,
  TurretComponent,
} from '../components';
import type { TeamId } from '../components';
import type { UnitDefinition } from './UnitDefinition';
import type { UnitRenderRefs } from './unitVisuals';

/** Attaches all components for `def` onto `entity`. The ability component is attached by the
 *  caller (it needs the AbilitySystem); see UnitFactory. */
export function assembleUnit(
  entity: Entity,
  def: UnitDefinition,
  teamId: TeamId,
  position: { x: number; y: number; z: number },
  refs: UnitRenderRefs
): void {
  const fpPosition = FPVector3.FromFloat(position.x, position.y, position.z);
  const fpRotation =
    teamId === 0 ? FPQuaternion.Identity() : FPQuaternion.FromYaw(FP.Pi);

  // --- common to every unit ---
  entity.addComponent(
    new TransformComponent(entity.id, fpPosition, fpRotation)
  );
  entity.addComponent(new TeamComponent(teamId));
  entity.addComponent(
    new UnitTypeComponent(def.type, FP.FromFloat(def.detectionRange))
  );
  entity.addComponent(new StatsComponent({ stopRange: def.stopRange }));
  entity.addComponent(new TargetStateComponent());
  entity.addComponent(new MeshComponent(refs.root));
  if (refs.detectionRing)
    entity.addComponent(new DetectionRingComponent(refs.detectionRing));
  entity.addComponent(
    new HealthBarComponent(
      refs.healthBarRoot,
      refs.healthBarFill,
      refs.healthBarFullWidth
    )
  );
  entity.addComponent(new InterpolationComponent(fpPosition, fpRotation));
  entity.addComponent(
    new PhysicsBodyComponent(entity.id, {
      radius: FP.FromFloat(def.radius),
      mass: FP.FromFloat(def.mass),
      friction: FP.FromFloat(0.15),
      restitution: FP.FromFloat(0.05),
    })
  );

  // --- optional components: driven purely by archetype data ---
  if (refs.spawnPoint)
    entity.addComponent(new SpawnPointComponent(refs.spawnPoint.marker));
  if (def.hasAutoAttackTimer)
    entity.addComponent(
      def.autoAttack
        ? new AutoAttackTimerComponent(
            def.autoAttack.abilityId,
            def.autoAttack.cooldownTicks
          )
        : new AutoAttackTimerComponent()
    );
  if (def.hasCubeState) entity.addComponent(new CubeStateComponent());
  if (def.hasTurret) entity.addComponent(new TurretComponent());
  if (def.aura) {
    entity.addComponent(new HealAuraComponent(def.aura, refs.auraRing ?? null));
    entity.addComponent(new SupportUnitTargetingComponent());
  }
}
