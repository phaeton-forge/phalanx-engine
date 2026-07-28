import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODEL_MANIFEST, type ModelAsset } from './AssetManifest';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

interface AsyncLoader<T> {
  loadAsync(url: string): Promise<T>;
}

/**
 * Centralized download authority for playground assets listed in the
 * manifest. Consumers read already-cached models synchronously via
 * {@link getModel} after {@link preloadAll} resolves.
 */
export class AssetManager {
  private readonly gltfLoader: GLTFLoader;
  private readonly models = new Map<string, THREE.Object3D>();
  private preloaded = false;
  private preloadPromise: Promise<void> | null = null;

  constructor() {
    this.gltfLoader = new GLTFLoader();
  }

  /**
   * Download every asset in the manifest. Resolves once every entry is
   * cached; rejects only after all retry attempts for a failing URL are
   * exhausted. Safe to call multiple times — subsequent calls share the
   * same in-flight promise or resolve immediately if already done.
   */
  preloadAll(): Promise<void> {
    if (this.preloaded) return Promise.resolve();
    if (this.preloadPromise) return this.preloadPromise;

    this.preloadPromise = (async () => {
      await Promise.all(MODEL_MANIFEST.map((asset) => this.loadModel(asset)));
      this.preloaded = true;
    })();

    return this.preloadPromise;
  }

  private async loadModel(asset: ModelAsset): Promise<void> {
    const gltf = await this.loadWithRetry(this.gltfLoader, asset.url);
    this.models.set(asset.key, gltf.scene);
  }

  /**
   * Retry wrapper around `loader.loadAsync`. Retries up to
   * `DEFAULT_MAX_RETRIES` times with exponential backoff starting at
   * `DEFAULT_RETRY_DELAY_MS`.
   */
  private async loadWithRetry<T>(
    loader: AsyncLoader<T>,
    url: string,
    maxAttempts = DEFAULT_MAX_RETRIES,
    baseDelayMs = DEFAULT_RETRY_DELAY_MS
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await loader.loadAsync(url);
      } catch (error) {
        lastError = error;
        console.warn(
          `AssetManager: load attempt ${attempt}/${maxAttempts} failed for ${url}`,
          error
        );

        if (attempt < maxAttempts) {
          await this.sleep(baseDelayMs * attempt);
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Cached glTF scene root by manifest key. Throws if not preloaded. */
  getModel(key: string): THREE.Object3D {
    const model = this.models.get(key);
    if (!model) {
      throw new Error(`AssetManager: model not preloaded: ${key}`);
    }
    return model;
  }

  /** Whether {@link preloadAll} has finished successfully. */
  isReady(): boolean {
    return this.preloaded;
  }

  /** Drop cached models and reset preload state. Does not dispose GPU resources. */
  clear(): void {
    this.models.clear();
    this.preloaded = false;
    this.preloadPromise = null;
  }
}

/** Shared singleton used by startup and unit visual code. */
export const assetManager = new AssetManager();
