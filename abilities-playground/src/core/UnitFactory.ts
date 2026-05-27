import * as THREE from 'three';
import { arenaParams } from '../config/constants';
import type { UnitKind } from '../config/unitRoster';
import type { ArenaScene } from './ArenaScene';
export interface SpawnPointRef {
    marker: THREE.Object3D;
}

export interface UnitRenderRefs {
  root: THREE.Object3D;
  healthBarRoot: THREE.Object3D;
  healthBarFill: THREE.Object3D;
  healthBarFullWidth: number;
  spawnPoint?: SpawnPointRef;
}

export class UnitFactory {
  private readonly arenaScene: ArenaScene;

  constructor(arenaScene: ArenaScene) {
    this.arenaScene = arenaScene;
  }

  createRenderRefs(kind: UnitKind, teamId: 0 | 1): UnitRenderRefs {
    const root = this.createMesh(kind, teamId);
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

    return { root, healthBarRoot, healthBarFill: fill, healthBarFullWidth, spawnPoint };
  }

  private createSphereSpawnPoint(): SpawnPointRef {
    const SPHERE_VISUAL_RADIUS = 3;
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
      case 'cone': return 3.5;
      case 'sphere': return 3;
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
      case 'cone':
        return new THREE.Mesh(
          this.arenaScene.trackGeometry(new THREE.ConeGeometry(3.2, 7, 24)),
          material,
        );
      case 'sphere':
        return new THREE.Mesh(
          this.arenaScene.trackGeometry(new THREE.SphereGeometry(3, 24, 16)),
          material,
        );
    }
  }
}
