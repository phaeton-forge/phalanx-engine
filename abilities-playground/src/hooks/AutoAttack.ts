import {ComponentType, MeshComponent, TeamComponent, TransformComponent} from "../components";
import {ProjectileEntity} from "../entities/Projectile.ts";
import type {ProjectileComponent} from "../components/ProjectileComponent.ts";
import {FPVector3} from "phalanx-math";
import type {AbilityActivationContext} from "phalanx-abilities";
import {GameWorld} from "phalanx-ecs";

export const autoAttack = (ctx: AbilityActivationContext, world: GameWorld) => {
    console.log(
        `[AutoAttack] tick=${ctx.tick} caster=${ctx.casterEntityId} targets=${JSON.stringify(ctx.resolvedTargets)}`,
    );
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

    const targetTransform = target.getComponent<TransformComponent>(ComponentType.Transform);
    const projectileEntity = world.pools?.acquire('projectile') as ProjectileEntity;
    const projectileComponent = projectileEntity.getComponent(ComponentType.Projectile) as ProjectileComponent;
    const projectileTeamComponent = projectileEntity.getComponent(ComponentType.Team) as TeamComponent;
    const mesh = projectileEntity.getComponent(ComponentType.Mesh) as MeshComponent;
    const casterTransform = caster.getComponent(ComponentType.Transform) as TransformComponent;
    const casterTeamComponent = caster.getComponent(ComponentType.Team) as TeamComponent;
    const visualPos = FPVector3.ToFloat(casterTransform!.fpPosition);

    mesh.root.position.set(visualPos.x, visualPos.y, visualPos.z);
    projectileComponent.reinitialize(targetTransform?.fpPosition as FPVector3);
    projectileTeamComponent.reinitialize(casterTeamComponent.teamId);
};