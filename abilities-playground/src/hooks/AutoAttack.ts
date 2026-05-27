import * as THREE from 'three';
import {ComponentType, InterpolationComponent, MeshComponent, SpawnPointComponent, TeamComponent, TransformComponent} from "../components";
import {ProjectileEntity} from "../entities/Projectile.ts";
import type {ProjectileComponent} from "../components/ProjectileComponent.ts";
import {FP, FPVector3} from "phalanx-math";
import type {AbilityActivationContext} from "phalanx-abilities";
import {GameWorld} from "phalanx-ecs";

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

    const projectileEntity = world.pools?.acquire('projectile') as ProjectileEntity;
    projectileEntity.reinitialize();
    world.entityManager.addEntity(projectileEntity);

    const projectileTransform = projectileEntity.getComponent<TransformComponent>(ComponentType.Transform)!;
    const interpolation = projectileEntity.getComponent<InterpolationComponent>(ComponentType.Interpolation)!;
    const projectileComponent = projectileEntity.getComponent<ProjectileComponent>(ComponentType.Projectile)!;
    const projectileTeamComponent = projectileEntity.getComponent<TeamComponent>(ComponentType.Team)!;

    projectileTransform.fpPosition = spawnPosition;
    interpolation.snapToPosition(spawnPosition);
    projectileComponent.reinitialize(targetTransform.fpPosition as FPVector3);
    projectileTeamComponent.reinitialize(casterTeamComponent.teamId);
};

function markerWorldPosition(
    transform: TransformComponent,
    mesh: MeshComponent,
    spawnPoint: SpawnPointComponent,
): FPVector3 {
    const pos = transform.fpPosition;
    mesh.root.position.set(FP.ToFloat(pos.x), FP.ToFloat(pos.y), FP.ToFloat(pos.z));
    mesh.root.updateWorldMatrix(false, true);
    spawnPoint.marker.getWorldPosition(_worldPos);
    return FPVector3.FromFloat(_worldPos.x, _worldPos.y, _worldPos.z);
}
