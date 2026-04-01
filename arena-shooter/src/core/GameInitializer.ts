import {
  PointLight,
  Vector3,
  ArcRotateCamera,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  type Scene,
  DefaultRenderingPipeline,
} from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials';
import type { EntityManager } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import { PhysicsBodyComponent } from 'phalanx-physics';
import { Entity } from 'phalanx-ecs';
import { ARENA_SIZE } from '../config/constants.ts';
import { TransformComponent } from '../components/TransformComponent.ts';
import { EntityTypeComponent } from '../components/EntityTypeComponent.ts';
import { FPVector3 } from 'phalanx-math';

export class GameInitializer {
  private scene: Scene;
  private entityManager: EntityManager;

  constructor(scene: Scene, entityManager: EntityManager) {
    this.scene = scene;
    this.entityManager = entityManager;
  }

  public setupScene(): ArcRotateCamera {
    // Dark background
    this.scene.clearColor = new Color4(0.01, 0.02, 0.03, 1);

    // No ambient light — only point lights and emissive
    // Centre fill light
    const centreLight = new PointLight('centreLight', new Vector3(0, 10, 0), this.scene);
    centreLight.intensity = 0.3;
    centreLight.diffuse = new Color3(0, 0.133, 0.267); // #002244

    // Floor with grid
    const ground = MeshBuilder.CreateGround('ground', {
      width: ARENA_SIZE,
      height: ARENA_SIZE,
    }, this.scene);
    const gridMat = new GridMaterial('gridMat', this.scene);
    gridMat.mainColor = new Color3(0.02, 0.04, 0.055); // #050A0E
    gridMat.lineColor = new Color3(0, 1, 1); // #00FFFF
    gridMat.opacity = 0.25;
    gridMat.majorUnitFrequency = 5;
    gridMat.minorUnitVisibility = 0.3;
    gridMat.gridRatio = 1;
    ground.material = gridMat;

    // Camera
    const camera = new ArcRotateCamera(
      'camera',
      0,
      0.1,
      40,
      Vector3.Zero(),
      this.scene,
    );
    camera.lowerBetaLimit = 0.1;
    camera.upperBetaLimit = 0.1;
    camera.lowerRadiusLimit = 40;
    camera.upperRadiusLimit = 40;
    camera.inputs.clear();

    // Post-processing
    const pipeline = new DefaultRenderingPipeline('pipeline', true, this.scene, [camera]);
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.8;
    pipeline.bloomWeight = 0.4;
    pipeline.bloomScale = 0.5;
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.contrast = 1.3;
    pipeline.imageProcessing.exposure = 1.1;

    this.createWalls();

    return camera;
  }

  private createWalls(): void {
    const half = ARENA_SIZE / 2;
    const wallThickness = 1;
    const wallHeight = 2;

    const wallConfigs = [
      { name: 'wall_north', x: 0, z: -half - wallThickness / 2, w: ARENA_SIZE + wallThickness * 2, d: wallThickness },
      { name: 'wall_south', x: 0, z: half + wallThickness / 2, w: ARENA_SIZE + wallThickness * 2, d: wallThickness },
      { name: 'wall_west', x: -half - wallThickness / 2, z: 0, w: wallThickness, d: ARENA_SIZE },
      { name: 'wall_east', x: half + wallThickness / 2, z: 0, w: wallThickness, d: ARENA_SIZE },
    ];

    for (const cfg of wallConfigs) {
      const entity = new Entity();
      const fpPos = FPVector3.FromFloat(cfg.x, wallHeight / 2, cfg.z);
      entity.addComponent(new TransformComponent(entity.id, fpPos));
      entity.addComponent(new EntityTypeComponent('wall'));
      entity.addComponent(new PhysicsBodyComponent(entity.id, {
        radius: FP.FromFloat(Math.max(cfg.w, cfg.d) / 2),
        mass: FP._0,
        isStatic: true,
      }));
      this.entityManager.addEntity(entity);

      // Visual mesh — dark wall with emissive top edge
      const box = MeshBuilder.CreateBox(cfg.name, {
        width: cfg.w,
        height: wallHeight,
        depth: cfg.d,
      }, this.scene);
      const mat = new StandardMaterial(`${cfg.name}_mat`, this.scene);
      mat.diffuseColor = new Color3(0.04, 0.082, 0.125); // #0A1520
      mat.emissiveColor = new Color3(0, 0, 0);
      box.material = mat;
      box.position = new Vector3(cfg.x, wallHeight / 2, cfg.z);

      // Thin emissive top edge
      const edge = MeshBuilder.CreateBox(`${cfg.name}_edge`, {
        width: cfg.w,
        height: 0.05,
        depth: cfg.d,
      }, this.scene);
      const edgeMat = new StandardMaterial(`${cfg.name}_edge_mat`, this.scene);
      edgeMat.emissiveColor = new Color3(0, 1, 1); // #00FFFF
      edgeMat.diffuseColor = new Color3(0, 0, 0);
      edge.material = edgeMat;
      edge.position = new Vector3(cfg.x, wallHeight + 0.025, cfg.z);
    }
  }
}
