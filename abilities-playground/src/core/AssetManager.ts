import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

export type WoodSetId = 'boards' | 'bright-checker' | 'dark-checker' | 'deck';
export type MetalPanelId = 'metal-panel1' | 'metal-panel2';
export type FloorSetId = 'floor';
export type EnvironmentId = 'env';

export interface PBRTextureSet {
  color: THREE.Texture;
  normal?: THREE.Texture;
  roughness?: THREE.Texture;
  metallic?: THREE.Texture;
  ao?: THREE.Texture;
  displacement?: THREE.Texture;
}

interface TextureFileSet {
  color: string;
  normal?: string;
  roughness?: string;
  metallic?: string;
  ao?: string;
  displacement?: string;
}

interface AssetManifest {
  wood: Record<WoodSetId, TextureFileSet>;
  metal: Record<MetalPanelId, TextureFileSet>;
  floor: Record<FloorSetId, TextureFileSet>;
  environment: Record<EnvironmentId, string>;
}

const ASSET_MANIFEST: AssetManifest = {
  wood: {
    boards: {
      color: '/boards/Wood076_1K-JPG_Color.jpg',
      normal: '/boards/Wood076_1K-JPG_NormalGL.jpg',
      roughness: '/boards/Wood076_1K-JPG_Roughness.jpg',
      ao: '/boards/Wood076_1K-JPG_AmbientOcclusion.jpg',
      displacement: '/boards/Wood076_1K-JPG_Displacement.jpg',
    },
    'bright-checker': {
      color: '/bright-checker/Wood095_1K-JPG_Color.jpg',
      normal: '/bright-checker/Wood095_1K-JPG_NormalGL.jpg',
      roughness: '/bright-checker/Wood095_1K-JPG_Roughness.jpg',
      displacement: '/bright-checker/Wood095_1K-JPG_Displacement.jpg',
    },
    'dark-checker': {
      color: '/dark-checker/Wood026_1K-JPG_Color.jpg',
      normal: '/dark-checker/Wood026_1K-JPG_NormalGL.jpg',
      roughness: '/dark-checker/Wood026_1K-JPG_Roughness.jpg',
      displacement: '/dark-checker/Wood026_1K-JPG_Displacement.jpg',
    },
    deck: {
      color: '/deck/Wood028_1K-JPG_Color.jpg',
      normal: '/deck/Wood028_1K-JPG_NormalGL.jpg',
      roughness: '/deck/Wood028_1K-JPG_Roughness.jpg',
      displacement: '/deck/Wood028_1K-JPG_Displacement.jpg',
    },
  },
  metal: {
    'metal-panel1': {
      color: '/metal-panel1/futuristic_panel_seamless_texture__BaseColor.png',
      normal: '/metal-panel1/futuristic_panel_seamless_texture__Normal_GL.png',
      roughness:
        '/metal-panel1/futuristic_panel_seamless_texture__Roughness.png',
      metallic: '/metal-panel1/futuristic_panel_seamless_texture__Metallic.png',
      ao: '/metal-panel1/futuristic_panel_seamless_texture__AO.png',
      displacement:
        '/metal-panel1/futuristic_panel_seamless_texture__Height.png',
    },
    'metal-panel2': {
      color:
        '/metal-panel2/dirty_futuristic_panel_seamless_texture__BaseColor.png',
      normal:
        '/metal-panel2/dirty_futuristic_panel_seamless_texture__Normal_GL.png',
      roughness:
        '/metal-panel2/dirty_futuristic_panel_seamless_texture__Roughness.png',
      metallic:
        '/metal-panel2/dirty_futuristic_panel_seamless_texture__Metallic.png',
      ao: '/metal-panel2/dirty_futuristic_panel_seamless_texture__AO.png',
      displacement:
        '/metal-panel2/dirty_futuristic_panel_seamless_texture__Height.png',
    },
  },
  floor: {
    floor: {
      color: '/floor/ornate_techno_grid_seamless_texture__BaseColor.png',
      normal: '/floor/ornate_techno_grid_seamless_texture__Normal_GL.png',
      roughness: '/floor/ornate_techno_grid_seamless_texture__Roughness.png',
      metallic: '/floor/ornate_techno_grid_seamless_texture__Metallic.png',
      ao: '/floor/ornate_techno_grid_seamless_texture__AO.png',
      displacement: '/floor/ornate_techno_grid_seamless_texture__Height.png',
    },
  },
  environment: {
    env: '/env/IndoorEnvironmentHDRI013_2K_HDR.exr',
  },
};

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

/**
 * Centralized asset loader for PBR textures and environment maps.
 *
 * - Loads all textures before the game starts.
 * - Retries failed loads with exponential backoff.
 * - Reports progress via callback.
 * - Provides cached texture sets to MaterialLibrary.
 * - Falls back gracefully: missing textures are reported but do not crash the game.
 */
export class AssetManager {
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly exrLoader = new EXRLoader();
  private readonly textures = new Map<string, THREE.Texture>();
  private environment: THREE.DataTexture | null = null;
  private loadPromise: Promise<void> | null = null;

  private total = 0;
  private loaded = 0;
  private failed = 0;

  /**
   * Load all configured assets. Safe to call multiple times — subsequent calls
   * return the same promise.
   */
  async loadAll(
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = this.doLoadAll(onProgress);
    return this.loadPromise;
  }

  private async doLoadAll(
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const [setId, fileSet] of Object.entries(ASSET_MANIFEST.wood)) {
      tasks.push(this.loadTextureSet('wood', setId, fileSet, onProgress));
    }

    for (const [setId, fileSet] of Object.entries(ASSET_MANIFEST.metal)) {
      tasks.push(this.loadTextureSet('metal', setId, fileSet, onProgress));
    }

    for (const [setId, fileSet] of Object.entries(ASSET_MANIFEST.floor)) {
      tasks.push(this.loadTextureSet('floor', setId, fileSet, onProgress));
    }

    for (const [envId, url] of Object.entries(ASSET_MANIFEST.environment)) {
      tasks.push(this.loadEnvironment(envId, url, onProgress));
    }

    this.total = tasks.length;
    this.loaded = 0;
    this.failed = 0;

    await Promise.all(tasks);

    if (this.failed > 0) {
      console.warn(
        `[AssetManager] ${this.failed} of ${this.total} asset groups failed to load; falling back to procedural materials.`
      );
    }
  }

  private async loadTextureSet(
    category: string,
    setId: string,
    fileSet: TextureFileSet,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const keys = Object.entries(fileSet) as [keyof TextureFileSet, string][];

    await Promise.all(
      keys.map(async ([kind, url]) => {
        const cacheKey = `${category}:${setId}:${kind}`;
        const texture = await this.loadTextureWithRetry(url, cacheKey);
        if (texture) {
          texture.colorSpace =
            kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          this.textures.set(cacheKey, texture);
        }
      })
    );

    this.loaded++;
    onProgress?.(this.loaded + this.failed, this.total);
  }

  private async loadEnvironment(
    envId: string,
    url: string,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    const texture = await this.loadEXRWithRetry(url, `env:${envId}`);
    if (texture) {
      this.environment = texture;
    }
    this.loaded++;
    onProgress?.(this.loaded + this.failed, this.total);
  }

  private loadTextureWithRetry(
    url: string,
    cacheKey: string,
    attempt = 1
  ): Promise<THREE.Texture | null> {
    return new Promise((resolve) => {
      this.textureLoader.load(
        url,
        (texture) => resolve(texture),
        undefined,
        (error) => {
          console.warn(
            `[AssetManager] Failed to load ${url} (attempt ${attempt}/${MAX_RETRIES})`,
            error
          );
          if (attempt < MAX_RETRIES) {
            setTimeout(() => {
              void this.loadTextureWithRetry(url, cacheKey, attempt + 1).then(
                resolve
              );
            }, RETRY_DELAY_MS * attempt);
          } else {
            console.error(`[AssetManager] Giving up on ${url}`);
            this.failed++;
            resolve(null);
          }
        }
      );
    });
  }

  private loadEXRWithRetry(
    url: string,
    cacheKey: string,
    attempt = 1
  ): Promise<THREE.DataTexture | null> {
    return new Promise((resolve) => {
      this.exrLoader.load(
        url,
        (texture) => resolve(texture),
        undefined,
        (error) => {
          console.warn(
            `[AssetManager] Failed to load ${url} (attempt ${attempt}/${MAX_RETRIES})`,
            error
          );
          if (attempt < MAX_RETRIES) {
            setTimeout(() => {
              void this.loadEXRWithRetry(url, cacheKey, attempt + 1).then(
                resolve
              );
            }, RETRY_DELAY_MS * attempt);
          } else {
            console.error(`[AssetManager] Giving up on ${url}`);
            this.failed++;
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Get a single texture by its category, set id and map kind.
   * Returns undefined if the texture failed to load.
   */
  getTexture(
    category: 'wood' | 'metal' | 'floor',
    setId: string,
    kind: keyof TextureFileSet
  ): THREE.Texture | undefined {
    return this.textures.get(`${category}:${setId}:${kind}`);
  }

  /**
   * Get a complete PBR texture set. Missing maps will be undefined.
   */
  getTextureSet(
    category: 'wood' | 'metal' | 'floor',
    setId: string
  ): PBRTextureSet {
    return {
      color: this.getTexture(category, setId, 'color')!,
      normal: this.getTexture(category, setId, 'normal'),
      roughness: this.getTexture(category, setId, 'roughness'),
      metallic: this.getTexture(category, setId, 'metallic'),
      ao: this.getTexture(category, setId, 'ao'),
      displacement: this.getTexture(category, setId, 'displacement'),
    };
  }

  /**
   * Get the loaded environment map. Null if loading failed.
   */
  getEnvironment(): THREE.DataTexture | null {
    return this.environment;
  }

  /**
   * True if all asset groups have finished loading (successfully or not).
   */
  get isReady(): boolean {
    return (
      this.loadPromise !== null && this.loaded + this.failed === this.total
    );
  }

  /**
   * Dispose all loaded textures and the environment map.
   */
  dispose(): void {
    for (const texture of this.textures.values()) {
      texture.dispose();
    }
    this.textures.clear();

    if (this.environment) {
      this.environment.dispose();
      this.environment = null;
    }

    this.loadPromise = null;
  }
}
