import {
  Scene,
  SceneLoader,
  AnimationGroup,
  TransformNode,
  AbstractMesh,
  Mesh,
  AssetContainer,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

/**
 * Preloaded model data stored in an AssetContainer
 */
export interface PreloadedModel {
  /** The asset container holding the model */
  container: AssetContainer;
  /** Animation group names available in the model */
  animationNames: string[];
}

/**
 * Instance of a preloaded model for use in the scene
 */
export interface ModelInstance {
  /** Root transform node containing all meshes */
  rootNode: TransformNode;
  /** All meshes in the instance */
  meshes: AbstractMesh[];
  /** Animation groups for this instance */
  animationGroups: AnimationGroup[];
  /** Dispose this instance */
  dispose: () => void;
}

/**
 * Asset paths for preloading
 * Note: Assets must be in the public folder to be available in production builds
 */
export const AssetPaths = {
  MUTANT_MODEL: '/assets/characters/MutantMerged.glb',
} as const;

/**
 * AssetManager - Preloads and manages game assets
 *
 * Loads all 3D models before the game starts so they're ready
 * for immediate use in formation grids, previews, and spawned units.
 */
export class AssetManager {
  private scene: Scene;
  private loadedAssets: Map<string, PreloadedModel> = new Map();
  private static instance: AssetManager | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    AssetManager.instance = this;
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): AssetManager | null {
    return AssetManager.instance;
  }

  /**
   * Preload all game assets
   * Call this before initializing the game
   */
  public async preloadAll(): Promise<void> {
    const startTime = performance.now();

    // Load all models in parallel
    await Promise.all([this.loadAsset('mutant', AssetPaths.MUTANT_MODEL)]);

    const endTime = performance.now();
    console.log(
      `[AssetManager] Assets preloaded in ${(endTime - startTime).toFixed(0)}ms`
    );
  }

  /**
   * Load a single asset into the cache
   */
  private async loadAsset(key: string, path: string): Promise<void> {
    try {
      // Load as AssetContainer so we can instantiate it multiple times
      const container = await SceneLoader.LoadAssetContainerAsync(
        '',
        path,
        this.scene
      );

      // Get animation names
      const animationNames = container.animationGroups.map((ag) => ag.name);

      this.loadedAssets.set(key, {
        container,
        animationNames,
      });
    } catch (error) {
      console.error(`[AssetManager] Failed to load ${key}:`, error);
      throw error;
    }
  }

  /**
   * Check if an asset is loaded
   */
  public isLoaded(key: string): boolean {
    return this.loadedAssets.has(key);
  }

  /**
   * Get animation names for an asset
   */
  public getAnimationNames(key: string): string[] {
    const asset = this.loadedAssets.get(key);
    return asset?.animationNames ?? [];
  }

  /**
   * Create an instance of a preloaded model
   * This is efficient as it clones from the cached container
   */
  public createInstance(key: string, name: string): ModelInstance | null {
    const asset = this.loadedAssets.get(key);
    if (!asset) {
      console.error(`[AssetManager] Asset "${key}" not loaded`);
      return null;
    }

    // Instantiate the container - this creates a new copy of all meshes and animations
    const instantiated = asset.container.instantiateModelsToScene(
      (sourceName) => `${name}_${sourceName}`,
      false // Don't clone materials (share them for efficiency)
    );

    // Create a wrapper node to contain ALL root nodes from the GLB
    // This ensures that when we rotate/scale/move the wrapper, ALL parts move together
    const rootNode = new TransformNode(`${name}_root`, this.scene);

    // Parent ALL instantiated root nodes to our wrapper
    for (const node of instantiated.rootNodes) {
      node.parent = rootNode;
    }

    // Collect all meshes
    const meshes: AbstractMesh[] = [];
    const collectMeshes = (node: TransformNode) => {
      if (node instanceof Mesh || node instanceof AbstractMesh) {
        meshes.push(node as AbstractMesh);
      }
      for (const child of node.getChildren()) {
        if (child instanceof TransformNode) {
          collectMeshes(child);
        }
      }
    };

    for (const node of instantiated.rootNodes) {
      if (node instanceof TransformNode) {
        collectMeshes(node);
      }
    }

    return {
      rootNode,
      meshes,
      animationGroups: instantiated.animationGroups,
      dispose: () => {
        // Dispose all animation groups
        for (const anim of instantiated.animationGroups) {
          anim.dispose();
        }
        // Dispose the wrapper (which disposes all children)
        rootNode.dispose();
      },
    };
  }

  /**
   * Create a preview instance (simplified, no animations, transparent)
   * Used for formation grid previews
   */
  public createPreviewInstance(
    key: string,
    name: string
  ): ModelInstance | null {
    const instance = this.createInstance(key, name);
    if (!instance) return null;

    // Stop all animations for preview
    for (const anim of instance.animationGroups) {
      anim.stop();
    }

    return instance;
  }

  /**
   * Dispose all loaded assets
   */
  public dispose(): void {
    for (const [key, asset] of this.loadedAssets) {
      console.log(`[AssetManager] Disposing ${key}`);
      asset.container.dispose();
    }
    this.loadedAssets.clear();
    AssetManager.instance = null;
  }
}
