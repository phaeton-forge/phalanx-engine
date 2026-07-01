import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { publicAssetUrl } from '../publicAssetUrl.ts';
import {
  TEXTURE_MANIFEST,
  ENV_MAP_PATH,
  AUDIO_MANIFEST,
  type TextureAsset,
} from './AssetManifest.ts';

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

interface AsyncLoader<T> {
  loadAsync(url: string): Promise<T>;
}

/**
 * Centralized download authority for all GPU textures, the HDR environment
 * map, and raw mp3 audio bytes.
 *
 * Each manifest URL is downloaded via three.js loaders with automatic retry
 * and exponential backoff, so transient failures against a static host
 * (e.g. Yandex Object Storage) don't block startup. Rendering and sound
 * code read already-cached assets synchronously via {@link getTexture},
 * {@link getEnvTexture}, and {@link getAudioBuffer}.
 */
export class AssetManager {
  private readonly textureLoader: THREE.TextureLoader;
  private readonly exrLoader: EXRLoader;
  private readonly fileLoader: THREE.FileLoader;
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly audioBuffers = new Map<string, ArrayBuffer>();
  private envTexture: THREE.DataTexture | null = null;
  private preloaded = false;
  private preloadPromise: Promise<void> | null = null;

  constructor() {
    this.textureLoader = new THREE.TextureLoader();
    this.exrLoader = new EXRLoader();
    this.fileLoader = new THREE.FileLoader();
    this.fileLoader.setResponseType('arraybuffer');
  }

  /**
   * Download every texture, EXR environment map, and mp3 listed in the
   * manifest. Resolves once every asset is cached; rejects only after all
   * retry attempts for a failing URL are exhausted.
   */
  preloadAll(): Promise<void> {
    if (this.preloaded) return Promise.resolve();
    if (this.preloadPromise) return this.preloadPromise;

    this.preloadPromise = (async () => {
      const loads: Promise<void>[] = [];

      for (const asset of TEXTURE_MANIFEST) {
        loads.push(this.loadTexture(asset));
      }

      loads.push(this.loadEnvironment());

      for (const path of AUDIO_MANIFEST) {
        loads.push(this.loadAudio(path));
      }

      await Promise.all(loads);
      this.preloaded = true;
    })();

    return this.preloadPromise;
  }

  private async loadTexture(asset: TextureAsset): Promise<void> {
    const url = publicAssetUrl(asset.path);
    const texture = await this.loadWithRetry(this.textureLoader, url);
    if (asset.colorSpace === 'srgb') {
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    this.textures.set(asset.path, texture);
  }

  private async loadEnvironment(): Promise<void> {
    const url = publicAssetUrl(ENV_MAP_PATH);
    this.envTexture = await this.loadWithRetry(this.exrLoader, url);
  }

  private async loadAudio(path: string): Promise<void> {
    const url = publicAssetUrl(path);
    const data = await this.loadWithRetry(this.fileLoader, url);
    this.audioBuffers.set(path, data as ArrayBuffer);
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
          const delayMs = baseDelayMs * attempt;
          await this.sleep(delayMs);
        }
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Cached texture by manifest path. Throws if preload has not finished. */
  getTexture(path: string): THREE.Texture {
    const texture = this.textures.get(path);
    if (!texture) {
      throw new Error(`AssetManager: texture not preloaded: ${path}`);
    }
    return texture;
  }

  /** Cached EXR environment texture. Throws if preload has not finished. */
  getEnvTexture(): THREE.DataTexture {
    if (!this.envTexture) {
      throw new Error('AssetManager: environment texture not preloaded');
    }
    return this.envTexture;
  }

  /** Cached raw mp3 bytes. Throws if preload has not finished. */
  getAudioBuffer(path: string): ArrayBuffer {
    const buffer = this.audioBuffers.get(path);
    if (!buffer) {
      throw new Error(`AssetManager: audio buffer not preloaded: ${path}`);
    }
    return buffer;
  }

  /** Dispose all cached GPU textures and reset preload state. */
  dispose(): void {
    for (const texture of this.textures.values()) {
      texture.dispose();
    }
    this.textures.clear();

    this.envTexture?.dispose();
    this.envTexture = null;

    this.audioBuffers.clear();
    this.preloaded = false;
    this.preloadPromise = null;
  }
}

/** Shared singleton used by rendering and sound systems. */
export const assetManager = new AssetManager();
