import * as THREE from 'three';
import { FP } from '@phalanx-engine/math';
import type { FixedPoint } from '@phalanx-engine/math';
import type { IComponent } from './Component';
import { ComponentType } from './Component';
import { DEFAULT_UNIT_DETECTION_RANGE, type UnitType } from '../units';
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
    detectionRadius: FixedPoint = FP.FromFloat(DEFAULT_UNIT_DETECTION_RANGE)
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
 * `auraRing` is the permanent green indicator mesh, a flat world-space ground
 * decal sized to {@link radius} (positioned each frame by RenderSyncSystem).
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
    auraRing: THREE.Object3D | null = null
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
  public readonly abilityId: string;
  public readonly cooldownTicks: number;

  constructor(
    abilityId = 'Ability.AutoAttack',
    cooldownTicks = 40 // = ATTACK_COOLDOWN_TICKS
  ) {
    this.abilityId = abilityId;
    this.cooldownTicks = cooldownTicks;
  }
}

export class MeshComponent implements IPoolableComponent {
  public readonly type = ComponentType.Mesh;
  public readonly root: THREE.Object3D;

  private static scene: THREE.Scene;

  public static initScene(scene: THREE.Scene): void {
    MeshComponent.scene = scene;
  }

  /**
   * Thin plasma bolt along local +Z. Root is a Group so RenderSync can set world
   * quaternion without wiping child pitch (same pattern as missiles).
   * Team tint is applied on spawn via {@link applyTeamColor}.
   * @param length Approx. bolt length; thickness scales with it.
   */
  public static createProjectile(length: number): MeshComponent {
    const coreRadius = length * 0.1;
    const boltLength = length * 1.8;
    const group = new THREE.Group();

    const addBoltLayer = (
      radius: number,
      opacity: number,
      layer: 'core' | 'mid' | 'halo',
      segments = 10
    ): void => {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, boltLength, segments),
        material
      );
      // Default cylinder axis is Y; pitch so the bolt flies along local +Z.
      mesh.rotation.x = Math.PI / 2;
      mesh.userData.plasmaLayer = layer;
      group.add(mesh);
    };

    // White-hot core + stacked additive shells = dense plasma look under ACES.
    addBoltLayer(coreRadius, 1.0, 'core');
    addBoltLayer(coreRadius * 1.7, 0.95, 'mid');
    addBoltLayer(coreRadius * 3.2, 0.55, 'halo');
    addBoltLayer(coreRadius * 5.5, 0.28, 'halo', 12);

    // Soft glowing tips so the ends read as energy, not cut plastic.
    const tipMat = (opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
    const tipZ = boltLength * 0.5;
    for (const z of [-tipZ, tipZ]) {
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(coreRadius * 1.4, 10, 8),
        tipMat(0.9)
      );
      tip.position.z = z;
      tip.userData.plasmaLayer = 'mid';
      group.add(tip);

      const tipHalo = new THREE.Mesh(
        new THREE.SphereGeometry(coreRadius * 3.0, 10, 8),
        tipMat(0.35)
      );
      tipHalo.position.z = z;
      tipHalo.userData.plasmaLayer = 'halo';
      group.add(tipHalo);
    }

    group.visible = false;
    return new MeshComponent(group);
  }

  /** Retint a pooled plasma bolt to a bright, saturated team energy color. */
  public applyTeamColor(teamId: TeamId): void {
    // Pastel arena body colors are too soft for plasma — push toward electric hues.
    const mid = teamId === 0 ? '#9fd8ff' : '#ff9a9a';
    const halo = teamId === 0 ? '#4ab0ff' : '#ff4d5c';

    this.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const material = obj.material as THREE.MeshBasicMaterial;
      const layer = obj.userData.plasmaLayer as string | undefined;
      if (layer === 'core') {
        material.color.set('#ffffff');
      } else if (layer === 'mid') {
        material.color.set(mid);
      } else {
        material.color.set(halo);
      }
    });
  }

  public static createMissile(): MeshComponent {
    const group = new THREE.Group();

    const bodyLength = 2.0;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.6, bodyLength, 12),
      new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        metalness: 0.5,
        roughness: 0.35,
      }),
    );
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;

    const makeFlame = (
      radius: number,
      height: number,
      color: number,
      opacity: number,
      emissiveIntensity: number,
    ): THREE.Mesh => {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(radius, height, 12),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity,
          metalness: 0,
          roughness: 1,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = -(bodyLength / 2 + height / 2);
      return flame;
    };

    // Soft realistic stack: hot core + warmer outer wash (self-lit, no PointLight)
    const flameCore = makeFlame(0.22, 0.7, 0xfff2cc, 0.95, 3.2);
    const flameOuter = makeFlame(0.48, 1.15, 0xff8a2a, 0.55, 2.0);

    group.add(body);
    group.add(flameOuter);
    group.add(flameCore);

    group.userData.flameCore = flameCore;
    group.userData.flameOuter = flameOuter;

    group.visible = false;
    return new MeshComponent(group);
  }

  /**
   * Shared shard geometry/material for all SAU shrapnel fragments. A single
   * squashed tetrahedron reads as a jagged metal chunk; sharing one geometry
   * and one material across every fragment keeps pooled spawns allocation-free.
   * Never disposed — shrapnel is pooled, and this pair lives for the app's
   * lifetime.
   */
  private static shrapnelGeometry?: THREE.BufferGeometry;
  private static shrapnelMaterial?: THREE.MeshStandardMaterial;

  /**
   * Shared incendiary shard material. Exposed so the cosmetic ShrapnelSpinSystem
   * can pulse its emissive intensity (the "about to blow" glow) once per frame
   * for every fragment at once. Undefined until the first shard is created.
   */
  public static getShrapnelMaterial(): THREE.MeshStandardMaterial | undefined {
    return MeshComponent.shrapnelMaterial;
  }

  /**
   * Jagged incendiary shard for SAU shrapnel fragments — dark scorched metal
   * with a hot glowing core, so it reads as live ordnance about to detonate
   * rather than inert debris (its emissive glow is pulsed by ShrapnelSpinSystem).
   * Root is a Group to match the RenderSync contract (world quaternion set on
   * the root); the inner shard mesh stays free for cosmetic spin. Visibility is
   * toggled by the pool hooks: hidden while dormant, shown on spawn.
   */
  public static createShrapnel(radius: number): MeshComponent {
    if (!MeshComponent.shrapnelGeometry) {
      const geometry = new THREE.TetrahedronGeometry(radius, 0);
      // Non-uniform squash turns the regular tetrahedron into an irregular
      // splinter silhouette from every angle.
      geometry.scale(1.5, 0.55, 0.9);
      MeshComponent.shrapnelGeometry = geometry;
      MeshComponent.shrapnelMaterial = new THREE.MeshStandardMaterial({
        color: 0x2b1a12,
        roughness: 0.4,
        metalness: 0.8,
        emissive: 0xff5a1e,
        emissiveIntensity: 1.6,
        toneMapped: false,
      });
    }

    const group = new THREE.Group();
    const shard = new THREE.Mesh(
      MeshComponent.shrapnelGeometry,
      MeshComponent.shrapnelMaterial
    );
    shard.castShadow = true;
    group.add(shard);
    group.visible = false;
    return new MeshComponent(group);
  }

  constructor(root: THREE.Object3D) {
    this.root = root;

    if (!MeshComponent.scene) {
      throw new Error(
        'MeshComponent.initScene must be called before creating MeshComponent'
      );
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

  constructor(root: THREE.Object3D, fill: THREE.Object3D, fullWidth: number) {
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
  public gameOver = false;
  public winner: 0 | 1 | null = null;
}

/**
 * Support-only flag: set to true when hostile units are within detection range.
 * MovementSystem uses this to keep support units stationary until enemies are
 * nearby, preventing them from pushing into allied collision at spawn.
 */
export class SupportUnitTargetingComponent implements IComponent {
  public readonly type = ComponentType.SupportUnitTargeting;
  public enemiesDetected = false;
}
