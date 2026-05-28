import type { IResettableComponent } from "phalanx-ecs";
import { ComponentType } from "./Component.ts";
import { FP, type FPVector2 as FPVector2Type } from "phalanx-math";
import { PROJECTILE_LIFETIME_SECONDS } from "../config/constants";

const DEFAULT_LIFETIME = FP.FromFloat(PROJECTILE_LIFETIME_SECONDS);

export class ProjectileComponent implements IResettableComponent {
    public readonly type = ComponentType.Projectile;
    public fpDirection2: FPVector2Type = { x: FP._0, y: FP._0 };
    public lifeTime = DEFAULT_LIFETIME;

    reinitialize(direction2: FPVector2Type): void {
        this.fpDirection2.x = direction2.x;
        this.fpDirection2.y = direction2.y;
        this.lifeTime = DEFAULT_LIFETIME;
    }

    reset(): void {
        this.fpDirection2.x = FP._0;
        this.fpDirection2.y = FP._0;
        this.lifeTime = DEFAULT_LIFETIME;
    }
}