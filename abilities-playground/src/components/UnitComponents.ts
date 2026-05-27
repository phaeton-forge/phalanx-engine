import * as THREE from 'three';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import type { IComponent } from './Component';
import { ComponentType } from './Component';
import type { UnitKind } from '../config/unitRoster';
import { DEFAULT_UNIT_DETECTION_RANGE } from '../config/unitRoster';
import type {IResettableComponent} from "phalanx-ecs";

export type TeamId = 0 | 1;

export class TeamComponent implements IResettableComponent {
  public readonly type = ComponentType.Team;
  public teamId: TeamId;

  constructor(teamId: TeamId = 0) {
    this.teamId = teamId;
  }

  reinitialize(teamId: TeamId): void {
      this.teamId = teamId;
  }

  reset(): void {
      this.teamId = 0;
  }
}

export class UnitTypeComponent implements IComponent {
  public readonly type = ComponentType.UnitType;
  public readonly kind: UnitKind;
  public readonly detectionRadius: FixedPoint;

  constructor(
    kind: UnitKind,
    detectionRadius: FixedPoint = FP.FromFloat(DEFAULT_UNIT_DETECTION_RANGE),
  ) {
    this.kind = kind;
    this.detectionRadius = detectionRadius;
  }
}

/** Team-colored XZ ring showing {@link UnitTypeComponent.detectionRadius} for tuning. */
export class DetectionRingComponent implements IComponent {
  public readonly type = ComponentType.DetectionRing;
  public readonly root: THREE.Object3D;

  constructor(root: THREE.Object3D) {
    this.root = root;
  }
}

export class StatsComponent implements IComponent {
  public readonly type = ComponentType.UnitStats;
  public readonly stopRange: FixedPoint;
  public alive = true;

  constructor(config: { stopRange: number }) {
    this.stopRange = FP.FromFloat(config.stopRange);
  }
}

export class TargetStateComponent implements IComponent {
  public readonly type = ComponentType.TargetState;
  public targetEntityId: number | null = null;
}

export class MeshComponent implements IResettableComponent {
  public readonly type = ComponentType.Mesh;
  public readonly root: THREE.Object3D;

  private static scene: THREE.Scene;

  public static initScene(scene: THREE.Scene): void {
    MeshComponent.scene = scene;
  }

  public static createProjectile(radius: number): MeshComponent {
    const root = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 32));
    root.visible = false;
    return new MeshComponent(root);
  }

  constructor(root: THREE.Object3D) {
    this.root = root;

    if (!MeshComponent.scene) {
      throw new Error('MeshComponent.initScene must be called before creating MeshComponent');
    }

    if (root.parent !== MeshComponent.scene) {
      MeshComponent.scene.add(root);
    }
  }

  reinitialize(): void {
    this.root.visible = true;
  }

  reset(): void {
    this.root.visible = false;
  }
}

export class HealthBarComponent implements IComponent {
  public readonly type = ComponentType.HealthBar;
  public readonly root: THREE.Object3D;
  public readonly fill: THREE.Object3D;
  public readonly fullWidth: number;

  constructor(
    root: THREE.Object3D,
    fill: THREE.Object3D,
    fullWidth: number,
  ) {
    this.root = root;
    this.fill = fill;
    this.fullWidth = fullWidth;
  }
}

export class DeathFadeComponent implements IComponent {
  public readonly type = ComponentType.DeathFade;
  public elapsed = 0;
  public readonly duration: number;

  constructor(duration = 0.6) {
    this.duration = duration;
  }
}

export class HealerAuraLinkComponent implements IComponent {
  public readonly type = ComponentType.HealerAuraLink;
  public auraEntityId: number | null;

  constructor(auraEntityId: number | null = null) {
    this.auraEntityId = auraEntityId;
  }
}

export class ConeBeamComponent implements IComponent {
  public readonly type = ComponentType.ConeBeam;
  public primaryTargetId: number | null = null;
  public secondaryTargetId: number | null = null;
}

export class SimulationStateComponent implements IComponent {
  public readonly type = ComponentType.SimulationState;
  public active = false;
  public startedByPlayerId: string | null = null;
  public gameOver = false;
  public winner: 0 | 1 | null = null;
}
