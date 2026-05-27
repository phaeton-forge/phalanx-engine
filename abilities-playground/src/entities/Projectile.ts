import * as THREE from 'three';
import {Entity, type IPoolable} from 'phalanx-ecs';
import {FP, FPVector3} from "phalanx-math";
import {
    ComponentType,
    InterpolationComponent,
    MeshComponent,
    TeamComponent,
    TransformComponent,
} from "../components";
import {PhysicsBodyComponent} from "phalanx-physics";
import {ProjectileComponent} from "../components/ProjectileComponent.ts";

const PROJECTILE_RADIUS = 0.2;
const PROJECTILE_MASS = 1;

export class ProjectileEntity extends Entity implements IPoolable {
    constructor() {
        super();

        console.log("Creating projectile entity");

        const fpPosition = FPVector3.FromFloat(0, 0, 0);

        this.addComponent(new ProjectileComponent());
        this.addComponent(new TransformComponent(this.id, fpPosition));
        this.addComponent(new TeamComponent(0)); // Team will be set when fired
        this.addComponent(new MeshComponent(new THREE.Mesh(new THREE.SphereGeometry(PROJECTILE_RADIUS, 32, 32)))); // Placeholder, should be set to actual mesh when fired

        const interpCmp = new InterpolationComponent();

        interpCmp.init(fpPosition);

        this.addComponent(interpCmp);
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

        // hide mesh
        (this.getComponent(ComponentType.Mesh) as MeshComponent).root.visible = false;

        // reset transform
        const transform = this.getComponent(ComponentType.Transform) as TransformComponent;
        transform.fpPosition = FPVector3.FromFloat(0, 0, 0);

        // reset team
        const teamComponent = this.getComponent(ComponentType.Team) as TeamComponent;
        teamComponent.teamId = 0;
    }
}
