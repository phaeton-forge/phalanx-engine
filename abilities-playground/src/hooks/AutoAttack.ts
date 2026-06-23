import * as THREE from 'three';
import type { TransformComponent } from '@phalanx-engine/physics';
import { ComponentType, MeshComponent, SpawnPointComponent, TeamComponent } from '../components';
import { ProjectileEntity } from '../entities/Projectile.ts';
import { FP, FPVector2, FPVector3 } from '@phalanx-engine/math';
import type { AbilityActivationContext } from '@phalanx-engine/abilities';
import { GameWorld } from '@phalanx-engine/ecs';

const _worldPos = new THREE.Vector3();

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
    const casterMesh = caster.getComponent<MeshComponent>(ComponentType.Mesh)!;
    const casterTeamComponent = caster.getComponent<TeamComponent>(ComponentType.Team)!;
    const spawnPoint = caster.getComponent<SpawnPointComponent>(ComponentType.SpawnPoint);

    const spawnPosition = spawnPoint
        ? markerWorldPosition(casterTransform, casterMesh, spawnPoint)
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

function markerWorldPosition(
    transform: TransformComponent,
    mesh: MeshComponent,
    spawnPoint: SpawnPointComponent,
): FPVector3 {
    const pos = transform.fpPosition;
    mesh.root.position.set(FP.ToFloat(pos.x), FP.ToFloat(pos.y), FP.ToFloat(pos.z));
    mesh.root.rotation.y = FP.ToFloat(transform.fpRotationY);
    mesh.root.updateWorldMatrix(false, true);
    spawnPoint.marker.getWorldPosition(_worldPos);
    return FPVector3.FromFloat(_worldPos.x, _worldPos.y, _worldPos.z);
}
