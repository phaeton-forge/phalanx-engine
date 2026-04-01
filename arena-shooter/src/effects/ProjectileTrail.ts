import {
  TrailMesh,
  StandardMaterial,
  Color3,
  type Scene,
  type Mesh,
} from '@babylonjs/core';
import { vfxConfig } from '../config/vfxConfig.ts';

export class ProjectileTrail {
  private trail: TrailMesh;
  private material: StandardMaterial;

  constructor(scene: Scene, sourceMesh: Mesh) {
    const cfg = vfxConfig.trail;
    this.trail = new TrailMesh('trail', sourceMesh, scene, {
      diameter: cfg.diameter,
      length: cfg.length,
      sections: cfg.sections,
      autoStart: true,
    });

    this.material = new StandardMaterial('trailMat_' + sourceMesh.name, scene);
    this.material.emissiveColor = new Color3(
      vfxConfig.colors.projectileEmissive.r,
      vfxConfig.colors.projectileEmissive.g,
      vfxConfig.colors.projectileEmissive.b,
    );
    this.material.alpha = cfg.alpha;
    this.material.backFaceCulling = false;
    this.material.disableLighting = true;
    this.trail.material = this.material;
  }

  public dispose(): void {
    this.trail.dispose();
    this.material.dispose();
  }
}
