import type { IResettableComponent } from "phalanx-ecs";
import { ComponentType } from "./Component.ts";
import { FP, type FPVector3 as FPVector3Type } from "phalanx-math";
import { PROJECTILE_LIFETIME_SECONDS } from "../config/constants";

const DEFAULT_LIFETIME = FP.FromFloat(PROJECTILE_LIFETIME_SECONDS);

export class ProjectileComponent implements IResettableComponent {
    public readonly type = ComponentType.Projectile;
    public fpTargetPosition: FPVector3Type = {
        x: FP._0,
        y: FP._0,
        z: FP._0,
    };
    public lifeTime = DEFAULT_LIFETIME;

    reinitialize(targetPosition: FPVector3Type): void {
        this.fpTargetPosition.x = targetPosition.x;
        this.fpTargetPosition.y = targetPosition.y;
        this.fpTargetPosition.z = targetPosition.z;
        this.lifeTime = DEFAULT_LIFETIME;
    }

    reset(): void {
        this.fpTargetPosition.x = FP._0;
        this.fpTargetPosition.y = FP._0;
        this.fpTargetPosition.z = FP._0;
        this.lifeTime = DEFAULT_LIFETIME;
    }
}