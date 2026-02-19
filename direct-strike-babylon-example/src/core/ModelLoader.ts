import {
  Scene,
  SceneLoader,
  AnimationGroup,
  TransformNode,
  AbstractMesh,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

/**
 * Loaded model result containing mesh hierarchy and animations
 */
export interface LoadedModel {
  /** Root transform node containing all meshes */
  rootNode: TransformNode;
  /** All meshes in the model */
  meshes: AbstractMesh[];
  /** All animation groups from the model */
  animationGroups: AnimationGroup[];
}

/**
 * Animation blend configuration for smooth transitions
 */
export interface AnimationBlendConfig {
  /** Target animation name */
  target: string;
  /** Blend duration in seconds */
  blendDuration?: number;
  /** Whether to loop the animation */
  loop?: boolean;
  /** Speed ratio for the animation */
  speedRatio?: number;
}

/**
 * ModelLoader - Utility for loading GLB/GLTF models with animations
 *
 * Features:
 * - Async model loading from GLB/GLTF files
 * - Animation group management
 * - Smooth animation blending/transitions
 * - Model caching for reuse
 */
export class ModelLoader {
  private scene: Scene;
  private modelCache: Map<string, LoadedModel> = new Map();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Load a GLB/GLTF model from a URL
   * @param url Path to the model file
   * @param name Unique name for this model instance
   * @returns Promise resolving to loaded model data
   */
  public async loadModel(url: string, name: string): Promise<LoadedModel> {
    const result = await SceneLoader.ImportMeshAsync(
      '', // Load all meshes
      '', // Root URL (use full path)
      url,
      this.scene
    );

    // Create a root transform node to contain everything
    const rootNode = new TransformNode(`${name}_root`, this.scene);

    // Parent all meshes to the root node
    for (const mesh of result.meshes) {
      // Only parent top-level meshes (those without a parent or with __root__ parent)
      if (!mesh.parent || mesh.parent.name === '__root__') {
        mesh.parent = rootNode;
      }
    }

    // Stop all animations initially
    for (const animGroup of result.animationGroups) {
      animGroup.stop();
    }

    const loadedModel: LoadedModel = {
      rootNode,
      meshes: result.meshes,
      animationGroups: result.animationGroups,
    };

    return loadedModel;
  }

  /**
   * Load a model and cache it for future cloning
   * @param url Path to the model file
   * @param cacheKey Key for caching
   */
  public async loadAndCacheModel(
    url: string,
    cacheKey: string
  ): Promise<LoadedModel> {
    if (this.modelCache.has(cacheKey)) {
      return this.modelCache.get(cacheKey)!;
    }

    const model = await this.loadModel(url, cacheKey);
    this.modelCache.set(cacheKey, model);
    return model;
  }

  /**
   * Clone a cached model for a new entity instance
   * @param cacheKey Key of the cached model
   * @param instanceName Name for the new instance
   * @returns Cloned model or null if not cached
   */
  public cloneCachedModel(
    cacheKey: string,
    instanceName: string
  ): LoadedModel | null {
    const cached = this.modelCache.get(cacheKey);
    if (!cached) return null;

    // Clone the root node (this clones all children)
    const clonedRoot = cached.rootNode.clone(`${instanceName}_root`, null);
    if (!clonedRoot) return null;

    // Collect cloned meshes
    const clonedMeshes: AbstractMesh[] = [];
    const collectMeshes = (node: TransformNode) => {
      for (const child of node.getChildMeshes()) {
        clonedMeshes.push(child);
      }
    };
    collectMeshes(clonedRoot);

    // Clone animation groups for the new instance
    const clonedAnimations: AnimationGroup[] = [];
    for (const animGroup of cached.animationGroups) {
      const cloned = animGroup.clone(`${instanceName}_${animGroup.name}`);
      // Retarget animations to cloned meshes
      // Animation groups target bones/nodes by name, so they should work with clones
      clonedAnimations.push(cloned);
    }

    return {
      rootNode: clonedRoot,
      meshes: clonedMeshes,
      animationGroups: clonedAnimations,
    };
  }

  /**
   * Get animation group by name from a loaded model
   */
  public static getAnimationByName(
    model: LoadedModel,
    name: string
  ): AnimationGroup | undefined {
    return model.animationGroups.find((ag) => ag.name.includes(name));
  }

  /**
   * Play an animation with smooth blending from current animation
   * @param model The loaded model
   * @param config Animation blend configuration
   * @returns The animation group being played, or null if not found
   */
  public static playAnimation(
    model: LoadedModel,
    config: AnimationBlendConfig
  ): AnimationGroup | null {
    const targetAnim = this.getAnimationByName(model, config.target);
    if (!targetAnim) {
      console.warn(`Animation "${config.target}" not found`);
      return null;
    }

    const blendDuration = config.blendDuration ?? 0.2;
    const loop = config.loop ?? true;
    const speedRatio = config.speedRatio ?? 1.0;

    // Stop other animations with blend out
    for (const anim of model.animationGroups) {
      if (anim !== targetAnim && anim.isPlaying) {
        // Blend out the current animation
        if (blendDuration > 0) {
          anim.setWeightForAllAnimatables(1.0);
          // Gradually reduce weight
          const startWeight = anim.weight;
          const startTime = Date.now();
          const fadeOut = () => {
            const elapsed = (Date.now() - startTime) / 1000;
            const progress = Math.min(elapsed / blendDuration, 1);
            const weight = startWeight * (1 - progress);
            anim.setWeightForAllAnimatables(weight);
            if (progress < 1 && anim.isPlaying) {
              requestAnimationFrame(fadeOut);
            } else {
              anim.stop();
            }
          };
          fadeOut();
        } else {
          anim.stop();
        }
      }
    }

    // Start target animation
    targetAnim.start(loop, speedRatio);

    // Blend in the target animation
    if (blendDuration > 0) {
      targetAnim.setWeightForAllAnimatables(0);
      const startTime = Date.now();
      const fadeIn = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        const progress = Math.min(elapsed / blendDuration, 1);
        targetAnim.setWeightForAllAnimatables(progress);
        if (progress < 1) {
          requestAnimationFrame(fadeIn);
        }
      };
      fadeIn();
    } else {
      targetAnim.setWeightForAllAnimatables(1);
    }

    return targetAnim;
  }

  /**
   * Play an animation once (no loop) and call a callback at a specific frame percentage
   * Useful for attack animations where damage is applied mid-animation
   * @param model The loaded model
   * @param animName Animation name
   * @param hitPointPercent Percentage through animation (0-1) to trigger callback
   * @param onHitPoint Callback when hit point is reached
   * @param onComplete Callback when animation completes
   * @returns The animation group or null if not found
   */
  public static playAnimationOnce(
    model: LoadedModel,
    animName: string,
    hitPointPercent: number,
    onHitPoint?: () => void,
    onComplete?: () => void,
    _blendDuration: number = 0.1
  ): AnimationGroup | null {
    const anim = this.getAnimationByName(model, animName);
    if (!anim) {
      console.warn(`Animation "${animName}" not found`);
      return null;
    }

    // Stop other animations with quick blend
    for (const other of model.animationGroups) {
      if (other !== anim && other.isPlaying) {
        other.stop();
      }
    }

    let hitPointTriggered = false;
    const totalFrames = anim.to - anim.from;
    const hitFrame = anim.from + totalFrames * hitPointPercent;

    // Track animation progress
    const checkProgress = () => {
      if (!anim.isPlaying) return;

      const currentFrame = anim.animatables[0]?.masterFrame ?? 0;

      if (!hitPointTriggered && currentFrame >= hitFrame) {
        hitPointTriggered = true;
        onHitPoint?.();
      }

      if (anim.isPlaying) {
        requestAnimationFrame(checkProgress);
      }
    };

    // Start animation (no loop)
    anim.start(false, 1.0, anim.from, anim.to, false);
    anim.setWeightForAllAnimatables(1);

    // Monitor progress
    requestAnimationFrame(checkProgress);

    // Set up completion handler
    anim.onAnimationGroupEndObservable.addOnce(() => {
      onComplete?.();
    });

    return anim;
  }

  /**
   * Dispose of cached models
   */
  public dispose(): void {
    for (const [, model] of this.modelCache) {
      for (const anim of model.animationGroups) {
        anim.dispose();
      }
      model.rootNode.dispose();
    }
    this.modelCache.clear();
  }
}
