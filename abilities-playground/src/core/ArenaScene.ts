import * as THREE from 'three';
import { arenaParams } from '../config/constants';
import { setupLighting } from '../rendering/LightingSetup';

export class ArenaScene {
  readonly scene = new THREE.Scene();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> =
    [];

  build(): void {
    this.scene.background = new THREE.Color(0x1a1a2e);
    setupLighting(this.scene);
    this.createArena();
  }

  /**
   * Apply the loaded HDRI environment map to the scene.
   * Called after AssetManager finishes loading.
   */
  applyEnvironment(envMap: THREE.DataTexture | null): void {
    if (envMap) {
      this.scene.environment = envMap;
    }
  }

  trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.disposables.push(geometry);
    return geometry;
  }

  trackMaterial<T extends THREE.Material>(material: T): T {
    this.disposables.push(material);
    return material;
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }

  private createArena(): void {
    const ground = new THREE.Mesh(
      this.trackGeometry(
        new THREE.PlaneGeometry(arenaParams.width, arenaParams.length)
      ),
      this.trackMaterial(
        new THREE.MeshStandardMaterial({ color: arenaParams.groundColor })
      )
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const centerLine = new THREE.Mesh(
      this.trackGeometry(new THREE.BoxGeometry(arenaParams.width, 0.05, 0.4)),
      this.trackMaterial(
        new THREE.MeshStandardMaterial({
          color: arenaParams.centerLineColor,
          opacity: 0.35,
          transparent: true,
        })
      )
    );
    centerLine.position.y = 0.03;
    this.scene.add(centerLine);

    const sideLineMaterial = this.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        opacity: 0.18,
        transparent: true,
      })
    );
    for (const x of [-arenaParams.width / 2, arenaParams.width / 2]) {
      const sideLine = new THREE.Mesh(
        this.trackGeometry(
          new THREE.BoxGeometry(0.35, 0.05, arenaParams.length)
        ),
        sideLineMaterial
      );
      sideLine.position.set(x, 0.04, 0);
      this.scene.add(sideLine);
    }

    const spawnLineMaterial = this.trackMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        opacity: 0.12,
        transparent: true,
      })
    );
    for (const z of [arenaParams.team1SpawnZ, arenaParams.team2SpawnZ]) {
      const spawnLine = new THREE.Mesh(
        this.trackGeometry(new THREE.BoxGeometry(arenaParams.width, 0.04, 0.3)),
        spawnLineMaterial
      );
      spawnLine.position.set(0, 0.05, z);
      this.scene.add(spawnLine);
    }
  }
}
