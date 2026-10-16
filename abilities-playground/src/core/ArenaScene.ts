import * as THREE from 'three';
import { arenaParams } from '../config/constants';

export class ArenaScene {
  readonly scene = new THREE.Scene();
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  build(): void {
    // Sage-tinted background blends with the floor so the arena edges no longer
    // fall off into black (was near-black warm #1a1714).
    this.scene.background = new THREE.Color(0x2b3a36);
    this.scene.add(new THREE.AmbientLight(0xffecd1, 0.55));
    // Cool green ground bounce (was warm brown 0x5c4a3d) keeps the pastel floor clean.
    this.scene.add(new THREE.HemisphereLight(0xffecd1, 0x46544e, 0.45));

    const sun = new THREE.DirectionalLight(0xfff0d9, 1.25);
    // Higher, more frontal sun lights the far half evenly; softened intensity so the
    // warmer background/floor don't blow out the red team.
    sun.position.set(40, 60, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 4096;
    sun.shadow.mapSize.height = 4096;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 200;

    const shadowSpan = 160;
    sun.shadow.camera.left = -shadowSpan;
    sun.shadow.camera.right = shadowSpan;
    sun.shadow.camera.top = shadowSpan;
    sun.shadow.camera.bottom = -shadowSpan;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;

    this.scene.add(sun);
    this.createArena();
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
      this.trackGeometry(new THREE.PlaneGeometry(arenaParams.width, arenaParams.length)),
      this.trackMaterial(new THREE.MeshStandardMaterial({ color: arenaParams.groundColor })),
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
        }),
      ),
    );
    centerLine.position.y = 0.03;
    centerLine.receiveShadow = true;
    this.scene.add(centerLine);

    const sideLineMaterial = this.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, opacity: 0.18, transparent: true }),
    );
    for (const x of [-arenaParams.width / 2, arenaParams.width / 2]) {
      const sideLine = new THREE.Mesh(
        this.trackGeometry(new THREE.BoxGeometry(0.35, 0.05, arenaParams.length)),
        sideLineMaterial,
      );
      sideLine.position.set(x, 0.04, 0);
      sideLine.receiveShadow = true;
      this.scene.add(sideLine);
    }

    const spawnLineMaterial = this.trackMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, opacity: 0.12, transparent: true }),
    );
    for (const z of [arenaParams.team1SpawnZ, arenaParams.team2SpawnZ]) {
      const spawnLine = new THREE.Mesh(
        this.trackGeometry(new THREE.BoxGeometry(arenaParams.width, 0.04, 0.3)),
        spawnLineMaterial,
      );
      spawnLine.position.set(0, 0.05, z);
      spawnLine.receiveShadow = true;
      this.scene.add(spawnLine);
    }
  }
}
