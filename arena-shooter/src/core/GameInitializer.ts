import {
  PointLight,
  HemisphericLight,
  Vector3,
  ArcRotateCamera,
  MeshBuilder,
  Mesh,
  StandardMaterial,
  Color3,
  Color4,
  type Scene,
  type Camera,
  DefaultRenderingPipeline,
  GlowLayer,
} from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials';
import { ARENA_SIZE } from '../config/constants.ts';
import { vfxConfig } from '../config/vfxConfig.ts';

export class GameInitializer {
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  public setupScene(): ArcRotateCamera {
    // Dark background
    this.scene.clearColor = new Color4(0.01, 0.02, 0.03, 1);

    // Centre fill light
    const centreLight = new PointLight('centreLight', new Vector3(0, 10, 0), this.scene);
    centreLight.intensity = 0.3;
    centreLight.diffuse = new Color3(0, 0.133, 0.267); // #002244

    // Ambient hemispheric light so diffuse colors are visible on entities
    const ambientLight = new HemisphericLight('ambientLight', new Vector3(0, 1, 0), this.scene);
    ambientLight.intensity = 0.9;
    ambientLight.diffuse = new Color3(0.9, 0.9, 1);
    ambientLight.groundColor = new Color3(0.1, 0.1, 0.15);
    ambientLight.specular = Color3.Black();

    // Floor with grid
    this.setupArenaFloor(ARENA_SIZE, ARENA_SIZE);

    // Camera — 30deg tilt with player follow
    const camera = this.setupPerspectiveCamera();

    // GlowLayer
    this.setupGlowLayer();

    // Post-processing pipeline
    this.setupPostProcessing(camera);

    // Emissive wall tubes
    this.createWalls();

    return camera;
  }

  public setupPerspectiveCamera(): ArcRotateCamera {
    const cfg = vfxConfig.camera;
    const camera = new ArcRotateCamera(
      'camera', cfg.alpha, cfg.beta, cfg.radius,
      Vector3.Zero(), this.scene,
    );
    camera.lowerBetaLimit = Math.PI / 4;
    camera.upperBetaLimit = Math.PI / 2.5;
    camera.lowerRadiusLimit = cfg.lowerRadiusLimit;
    camera.upperRadiusLimit = cfg.upperRadiusLimit;
    camera.inputs.clear(); // no user camera control
    return camera;
  }

  public setupGlowLayer(): GlowLayer {
    const cfg = vfxConfig.glow;
    const gl = new GlowLayer('glow', this.scene, {
      mainTextureFixedSize: cfg.mainTextureFixedSize,
      blurKernelSize: cfg.blurKernelSize,
    });
    gl.intensity = cfg.intensity;

    // Per-mesh glow control: walls/projectiles glow bright, entities subtle, floor none
    gl.customEmissiveColorSelector = (mesh, _subMesh, _material, result) => {
      if (mesh.metadata?.isWall) {
        result.set(0, 0.8, 0.9, 1);
      } else if (mesh.metadata?.isProjectile) {
        result.set(0, 0.9, 1, 1);
      } else if (mesh.metadata?.team === 'player') {
        result.set(0, 0.15, 0.18, 1);
      } else if (mesh.metadata?.team === 'enemy') {
        result.set(0.18, 0.04, 0.02, 1);
      } else {
        result.set(0, 0, 0, 0);
      }
    };

    return gl;
  }

  public setupPostProcessing(camera: Camera): DefaultRenderingPipeline {
    const cfg = vfxConfig.pipeline;
    const pipeline = new DefaultRenderingPipeline('pipeline', true, this.scene, [camera]);

    pipeline.bloomEnabled = cfg.bloomEnabled;
    pipeline.bloomThreshold = cfg.bloomThreshold;
    pipeline.bloomWeight = cfg.bloomWeight;
    pipeline.bloomKernel = cfg.bloomKernel;
    pipeline.bloomScale = cfg.bloomScale;

    pipeline.fxaaEnabled = cfg.fxaaEnabled;

    pipeline.chromaticAberrationEnabled = cfg.chromaticAberrationEnabled;
    pipeline.chromaticAberration.aberrationAmount = cfg.chromaticAberrationAmount;
    pipeline.chromaticAberration.radialIntensity = cfg.chromaticAberrationRadialIntensity;

    pipeline.grainEnabled = cfg.grainEnabled;
    pipeline.grain.intensity = cfg.grainIntensity;
    pipeline.grain.animated = cfg.grainAnimated;

    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.contrast = cfg.contrast;
    pipeline.imageProcessing.exposure = cfg.exposure;
    pipeline.imageProcessing.vignetteEnabled = cfg.vignetteEnabled;
    pipeline.imageProcessing.vignetteWeight = cfg.vignetteWeight;
    pipeline.imageProcessing.vignetteCameraFov = cfg.vignetteFov;
    pipeline.imageProcessing.vignetteColor = new Color4(
      cfg.vignetteColor.r, cfg.vignetteColor.g, cfg.vignetteColor.b, 0,
    );

    return pipeline;
  }

  public setupArenaFloor(width: number, height: number): Mesh {
    const ground = MeshBuilder.CreateGround('ground', {
      width, height, subdivisions: 2,
    }, this.scene);

    const cfg = vfxConfig.colors.arenaGrid;
    const gridMat = new GridMaterial('gridMat', this.scene);
    gridMat.majorUnitFrequency = 5;
    gridMat.minorUnitVisibility = 0.3;
    gridMat.gridRatio = 1;
    gridMat.mainColor = new Color3(cfg.mainColor.r, cfg.mainColor.g, cfg.mainColor.b);
    gridMat.lineColor = new Color3(cfg.lineColor.r, cfg.lineColor.g, cfg.lineColor.b);
    gridMat.opacity = 0.98;
    ground.material = gridMat;
    return ground;
  }

  /**
   * Create emissive tube walls that react with GlowLayer.
   * Physics boundary is handled by PhysicsWorld.worldBounds.
   */
  private createWalls(): void {
    const half = ARENA_SIZE / 2;
    const y = 0.5;

    // Wall edge pairs: [from, to]
    const edges: { name: string; from: Vector3; to: Vector3 }[] = [
      { name: 'wall_north', from: new Vector3(-half, y, -half), to: new Vector3(half, y, -half) },
      { name: 'wall_south', from: new Vector3(-half, y, half), to: new Vector3(half, y, half) },
      { name: 'wall_west', from: new Vector3(-half, y, -half), to: new Vector3(-half, y, half) },
      { name: 'wall_east', from: new Vector3(half, y, -half), to: new Vector3(half, y, half) },
    ];

    for (const edge of edges) {
      this.createArenaWall(edge.name, edge.from, edge.to);
    }
  }

  public createArenaWall(name: string, from: Vector3, to: Vector3): Mesh {
    const tube = MeshBuilder.CreateTube(name, {
      path: [from, to],
      radius: 0.08,
      tessellation: 6,
      cap: Mesh.CAP_ALL,
    }, this.scene);
    const mat = new StandardMaterial(name + 'Mat', this.scene);
    mat.emissiveColor = new Color3(
      vfxConfig.colors.wall.emissive.r,
      vfxConfig.colors.wall.emissive.g,
      vfxConfig.colors.wall.emissive.b,
    );
    mat.disableLighting = true;
    tube.material = mat;
    tube.metadata = { isWall: true };
    return tube;
  }
}
