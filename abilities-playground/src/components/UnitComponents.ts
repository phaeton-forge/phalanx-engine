import * as THREE from 'three';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import type { IComponent } from './Component';
import { ComponentType } from './Component';
import { DEFAULT_UNIT_DETECTION_RANGE, type UnitType } from '../units/UnitType';
import type { IPoolableComponent } from '@phalanx-engine/ecs';

export type TeamId = 0 | 1;

export class TeamComponent {
  public readonly type = ComponentType.Team;
  public teamId: TeamId;

  constructor(teamId: TeamId = 0) {
    this.teamId = teamId;
  }
}

export class UnitTypeComponent implements IComponent {
  public readonly type = ComponentType.UnitType;
  public readonly kind: UnitType;
  public readonly detectionRadius: FixedPoint;

  constructor(
    kind: UnitType,
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

/**
 * Drives the support healing aura. Owned by `support` units. Heal application
 * is performed by the HealingAuraSystem: every {@link pulseTicks} ticks it
 * queries allies within {@link radius} and applies a heal pulse.
 *
 * `auraRing` is the permanent green indicator mesh (child of the unit root),
 * sized to {@link radius}.
 */
export class HealAuraComponent implements IComponent {
  public readonly type = ComponentType.HealAura;
  public readonly radius: FixedPoint;
  public readonly pulseTicks: number;
  public readonly auraRing: THREE.Object3D | null;
  /** Counts down to the next pulse; starts at 1 so the aura fires shortly after spawn. */
  public ticksUntilPulse = 1;

  constructor(
    config: { radius: number; pulseTicks: number },
    auraRing: THREE.Object3D | null = null,
  ) {
    this.radius = FP.FromFloat(config.radius);
    this.pulseTicks = config.pulseTicks;
    this.auraRing = auraRing;
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

/** Tracks up to two enemy and two ally beam targets for cube units. */
export class CubeStateComponent implements IComponent {
  public readonly type = ComponentType.CubeState;
  public readonly enemyTargets: number[] = [];
  public readonly allyTargets: number[] = [];
}

/** Per-unit auto-attack cooldown driven by {@link AttackSpeedMultiplier}. */
export class AutoAttackTimerComponent implements IComponent {
  public readonly type = ComponentType.AutoAttackTimer;
  public ticksUntilNextAttack: FixedPoint = FP.FromInt(0);
}

export class MeshComponent implements IPoolableComponent {
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

  public static createMissile(): MeshComponent {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.6, 2.0, 12),
      new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.3, roughness: 0.5 }),
    );
    body.rotation.x = Math.PI / 2;

    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1.2, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffaa33,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -(2.0 / 2 + 1.2 / 2);

    group.add(body);
    group.add(flame);
    group.visible = false;
    return new MeshComponent(group);
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

  onSpawn(): void {
    this.root.visible = true;
  }

  onDespawn(): void {
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


export class SimulationStateComponent implements IComponent {
  public readonly type = ComponentType.SimulationState;
  public active = false;
  public startedByPlayerId: string | null = null;
  public gameOver = false;
  public winner: 0 | 1 | null = null;
}
