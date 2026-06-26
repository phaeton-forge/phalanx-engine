import * as THREE from 'three';
import { arenaParams } from '../config/constants';
import type { UnitKind } from '../config/unitRoster';
import { DEFAULT_UNIT_DETECTION_RANGE } from '../config/unitRoster';
import type { ArenaScene } from './ArenaScene';
export interface SpawnPointRef {
    marker: THREE.Object3D;
}

export interface UnitRenderRefs {
  root: THREE.Object3D;
  healthBarRoot: THREE.Object3D;
  healthBarFill: THREE.Object3D;
  healthBarFullWidth: number;
  detectionRing: THREE.Mesh;
  spawnPoint?: SpawnPointRef;
  /** Permanent green aura indicator ring (support units only). */
  auraRing?: THREE.Mesh;
}

export class UnitFactory {
  private readonly arenaScene: ArenaScene;

  constructor(arenaScene: ArenaScene) {
    this.arenaScene = arenaScene;
  }

  createRenderRefs(
    kind: UnitKind,
    teamId: 0 | 1,
    detectionRange = DEFAULT_UNIT_DETECTION_RANGE,
    auraRadius?: number,
  ): UnitRenderRefs {
    const root = this.createMesh(kind, teamId);
    const detectionRing = this.createDetectionRing(teamId, detectionRange);

    root.add(detectionRing);

    const healthBarRoot = new THREE.Group();
    const healthBarFullWidth = 6;
    const background = new THREE.Mesh(
      this.arenaScene.trackGeometry(new THREE.BoxGeometry(healthBarFullWidth, 0.35, 0.25)),
      this.arenaScene.trackMaterial(new THREE.MeshBasicMaterial({ color: 0x1f1f1f })),
    );
    const fill = new THREE.Mesh(
      this.arenaScene.trackGeometry(new THREE.BoxGeometry(healthBarFullWidth, 0.4, 0.3)),
      this.arenaScene.trackMaterial(
        new THREE.MeshBasicMaterial({
          color: teamId === 0 ? arenaParams.team1Color : arenaParams.team2Color,
        }),
      ),
    );

    fill.position.z = -0.02;
    healthBarRoot.add(background);
    healthBarRoot.add(fill);

    let spawnPoint: SpawnPointRef | undefined;

    if (kind === 'sphere') {
      spawnPoint = this.createSphereSpawnPoint();
      root.add(spawnPoint.marker);
    }

    let auraRing: THREE.Mesh | undefined;

    if (kind === 'support' && auraRadius !== undefined) {
      auraRing = this.createAuraRing(auraRadius);
      root.add(auraRing);
    }

    return {
      root,
      healthBarRoot,
      healthBarFill: fill,
      healthBarFullWidth,
      detectionRing,
      spawnPoint,
      auraRing,
    };
  }

  /** Thin green ring sized to the healing-aura radius; permanent aura indicator. */
  private createAuraRing(radius: number): THREE.Mesh {
    const ring = new THREE.Mesh(
      this.arenaScene.trackGeometry(new THREE.RingGeometry(0.96, 1, 96)),
      this.arenaScene.trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x44ff88,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.renderOrder = 2;
    ring.scale.set(radius, radius, 1);
    return ring;
  }

  /** Unit-radius ring; scale X/Z in RenderSyncSystem to match detectionRange. */
  private createDetectionRing(teamId: 0 | 1, radius: number): THREE.Mesh {
    const teamColor = teamId === 0 ? arenaParams.team1Color : arenaParams.team2Color;
    const ring = new THREE.Mesh(
      this.arenaScene.trackGeometry(new THREE.RingGeometry(0.97, 1, 64)),
      this.arenaScene.trackMaterial(
        new THREE.MeshBasicMaterial({
          color: teamColor,
          transparent: true,
          opacity: 0.45,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.renderOrder = 1;
    ring.scale.set(radius, radius, 1);
    return ring;
  }

  private createSphereSpawnPoint(): SpawnPointRef {
    const SPHERE_VISUAL_RADIUS = 2;
    const FORWARD_OFFSET = 1.0;
    const offsetZ = SPHERE_VISUAL_RADIUS + FORWARD_OFFSET;

    const marker = new THREE.Object3D();
    marker.position.set(0, 0, offsetZ);

    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, 0),
      1.5,
      0xffff00,
      0.4,
      0.25,
    );
    marker.add(arrow);

    return { marker };
  }

  getHeightOffset(kind: UnitKind): number {
    switch (kind) {
      case 'cube': return 2.5;
      case 'sphere': return 2;
      case 'support': return 2;
      case 'rocket': return 3;
    }
  }

  private createMesh(kind: UnitKind, teamId: 0 | 1): THREE.Mesh {
    const material = this.arenaScene.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: teamId === 0 ? arenaParams.team1Color : arenaParams.team2Color,
        roughness: 0.55,
        metalness: 0.05,
      }),
    );
    switch (kind) {
      case 'cube':
        return new THREE.Mesh(
          this.arenaScene.trackGeometry(new THREE.BoxGeometry(5, 5, 5)),
          material,
        );
      case 'sphere':
        return new THREE.Mesh(
          this.arenaScene.trackGeometry(new THREE.SphereGeometry(2, 24, 16)),
          material,
        );
      case 'support':
        // Cone geometry: radius 2, height 4 → base sits on the ground at the
        // height offset returned by getHeightOffset('support').
        return new THREE.Mesh(
          this.arenaScene.trackGeometry(new THREE.ConeGeometry(2, 4, 24)),
          material,
        );
      case 'rocket':
        return new THREE.Mesh(
          this.arenaScene.trackGeometry(new THREE.OctahedronGeometry(3)),
          material,
        );
    }
  }
}
