/**
 * Central asset manifest for the Chapayev game.
 *
 * This is the single source of truth for every texture, HDR environment map,
 * and audio file downloaded by the AssetManager. Rendering and sound code
 * should import paths from here instead of hardcoding them.
 */

export interface TextureAsset {
  path: string;
  colorSpace?: 'srgb' | 'linear';
}

export const DECK_TEXTURES = {
  color: 'textures/deck/Wood028_1K-JPG_Color.jpg',
  normal: 'textures/deck/Wood028_1K-JPG_NormalGL.jpg',
  roughness: 'textures/deck/Wood028_1K-JPG_Roughness.jpg',
} as const;

export const BOARD_TEXTURES = {
  color: 'textures/boards/Wood076_1K-JPG_Color.jpg',
  normal: 'textures/boards/Wood076_1K-JPG_NormalGL.jpg',
  roughness: 'textures/boards/Wood076_1K-JPG_Roughness.jpg',
  ambientOcclusion: 'textures/boards/Wood076_1K-JPG_AmbientOcclusion.jpg',
} as const;

export const BRIGHT_CHECKER_TEXTURES = {
  color: 'textures/bright-checker/Wood095_1K-JPG_Color.jpg',
  normal: 'textures/bright-checker/Wood095_1K-JPG_NormalGL.jpg',
  roughness: 'textures/bright-checker/Wood095_1K-JPG_Roughness.jpg',
} as const;

export const DARK_CHECKER_TEXTURES = {
  color: 'textures/dark-checker/Wood026_1K-JPG_Color.jpg',
  normal: 'textures/dark-checker/Wood026_1K-JPG_NormalGL.jpg',
  roughness: 'textures/dark-checker/Wood026_1K-JPG_Roughness.jpg',
} as const;

export const ENV_MAP_PATH = 'textures/env/IndoorEnvironmentHDRI013_2K_HDR.exr';

export const HIT_SOUND_PATHS: readonly string[] = [
  'sounds/hit_01.mp3',
  'sounds/hit_02.mp3',
  'sounds/hit_03.mp3',
  'sounds/hit_04.mp3',
] as const;

export const MOVEMENT_SOUND_PATH = 'sounds/checker_movement.mp3';

/** Rim hit reuses one of the hit variants — the manifest deduplicates URLs. */
export const RIM_HIT_SOUND_PATH = 'sounds/hit_04.mp3';

export const FALL_OFF_SOUND_PATHS: readonly string[] = [
  'sounds/checker-fall-off.mp3',
  'sounds/checker-fall-off_02.mp3',
] as const;

export const BGM_SOUND_PATHS: readonly string[] = [
  'sounds/bg_01.mp3',
  'sounds/bg_02.mp3',
] as const;

export const TEXTURE_MANIFEST: readonly TextureAsset[] = [
  { path: DECK_TEXTURES.color, colorSpace: 'srgb' },
  { path: DECK_TEXTURES.normal },
  { path: DECK_TEXTURES.roughness },
  { path: BOARD_TEXTURES.color, colorSpace: 'srgb' },
  { path: BOARD_TEXTURES.normal },
  { path: BOARD_TEXTURES.roughness },
  { path: BOARD_TEXTURES.ambientOcclusion },
  { path: BRIGHT_CHECKER_TEXTURES.color, colorSpace: 'srgb' },
  { path: BRIGHT_CHECKER_TEXTURES.normal },
  { path: BRIGHT_CHECKER_TEXTURES.roughness },
  { path: DARK_CHECKER_TEXTURES.color, colorSpace: 'srgb' },
  { path: DARK_CHECKER_TEXTURES.normal },
  { path: DARK_CHECKER_TEXTURES.roughness },
] as const;

/**
 * Flat, deduplicated list of every mp3 path the AssetManager must download.
 * Order is preserved for stable loading-manager progress.
 */
export const AUDIO_MANIFEST: readonly string[] = [
  ...new Set([
    ...HIT_SOUND_PATHS,
    MOVEMENT_SOUND_PATH,
    RIM_HIT_SOUND_PATH,
    ...FALL_OFF_SOUND_PATHS,
    ...BGM_SOUND_PATHS,
  ]),
];
