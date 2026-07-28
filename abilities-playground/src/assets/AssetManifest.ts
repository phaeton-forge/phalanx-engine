/**
 * Central asset manifest for the abilities playground.
 *
 * Single source of truth for every downloadable asset the AssetManager
 * preloads. Unit/visual code should import keys/paths from here instead of
 * hardcoding URLs or issuing their own loaders.
 */

import plasmaTankModelUrl from '../../models/hbm-1-smel.glb?url';

export interface ModelAsset {
  /** Stable cache key used by {@link AssetManager.getModel}. */
  key: string;
  /** Resolved URL (Vite `?url` import so the file is hashed in production). */
  url: string;
}

export const MODEL_KEYS = {
  plasmaTank: 'plasmaTank',
} as const;

export type ModelKey = (typeof MODEL_KEYS)[keyof typeof MODEL_KEYS];

export const PLASMA_TANK_MODEL: ModelAsset = {
  key: MODEL_KEYS.plasmaTank,
  url: plasmaTankModelUrl,
};

/**
 * Flat list of every glTF/GLB the AssetManager must download.
 * Add new models here — consumers read them via `assetManager.getModel(key)`.
 */
export const MODEL_MANIFEST: readonly ModelAsset[] = [PLASMA_TANK_MODEL];
