import type { TransformComponent } from '@phalanx-engine/physics';
import { ComponentType, SpawnPointComponent, TeamComponent } from '../components';
import { ProjectileEntity } from '../entities/Projectile.ts';
import { FP, FPVector2, FPVector3, FPQuaternion } from '@phalanx-engine/math';
import type { AbilityActivationContext } from '@phalanx-engine/abilities';
import { GameWorld } from '@phalanx-engine/ecs';

/** Local +Z offset of the sphere forward marker; keep in sync with UnitFactory. */
const SPHERE_MARKER_OFFSET_Z = 3;

export const autoAttack = (ctx: AbilityActivationContext, world: GameWorld) => {
    const target = world.entityManager.getEntity(ctx.resolvedTargets[0]);
    const caster = world.entityManager.getEntity(ctx.casterEntityId);

    if (!target) {
        console.error(`Target entity not found: ${ctx.resolvedTargets[0]}`);
        return;
    }

    if (!caster) {
        console.error(`Caster entity not found: ${ctx.casterEntityId}`);
        return;
    }

    const targetTransform = target.getComponent<TransformComponent>(ComponentType.Transform)!;
    const casterTransform = caster.getComponent<TransformComponent>(ComponentType.Transform)!;
    const casterTeamComponent = caster.getComponent<TeamComponent>(ComponentType.Team)!;
    const spawnPoint = caster.getComponent<SpawnPointComponent>(ComponentType.SpawnPoint);

    const spawnPosition = spawnPoint
        ? markerWorldPosition(casterTransform)
        : casterTransform.fpPosition;

    const targetPos = targetTransform.fpPosition as FPVector3;
    const direction2 = FPVector2.Normalize({
        x: FP.Sub(targetPos.x, spawnPosition.x),
        y: FP.Sub(targetPos.z, spawnPosition.z),
    });

    world.pools!.spawn<ProjectileEntity>('projectile', {
        fpPosition: spawnPosition,
        fpDirection2: direction2,
        teamId: casterTeamComponent.teamId,
    });
};

function markerWorldPosition(transform: TransformComponent): FPVector3 {
    const localOffset = FPVector3.FromFloat(0, 0, SPHERE_MARKER_OFFSET_Z);
    const worldOffset = FPQuaternion.RotateVector(transform.fpRotation, localOffset);
    return FPVector3.Add(transform.fpPosition, worldOffset);
}
