import { FPVector3 } from '@phalanx-engine/math';
import type { FPVector3 as FPVector3Type } from '@phalanx-engine/math';

// ── Board dimensions ──────────────────────────────────────────────
/** Number of cells per side */
export const BOARD_SIZE = 8;

/** World-space size of one cell */
export const CELL_SIZE = 1.0;

/** Total board extent in world units */
export const BOARD_EXTENT = BOARD_SIZE * CELL_SIZE; // 8

/** Height (thickness) of the board box */
export const BOARD_HEIGHT = 0.25;

/** Height (thickness) of the board rim/frame that overhangs the playing surface */
export const BOARD_RIM_WIDTH = 0.3;

// ── Checker dimensions ────────────────────────────────────────────
export const CHECKER_RADIUS = 0.38;
export const CHECKER_HEIGHT = 0.15;
export const CHECKER_SEGMENTS = 32;
/** Radius of the rounded bevel on checker top/bottom edges */
export const CHECKER_BEVEL_RADIUS = 0.01;
/** Number of arc steps in each bevel curve (more = smoother) */
export const CHECKER_BEVEL_SEGMENTS = 8;

/** Number of checkers per team */
export const CHECKERS_PER_TEAM = 8;

// ── Camera ────────────────────────────────────────────────────────
export const CAMERA_FOV = 70;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 100;
export const CAMERA_POSITION = { x: 0, y: 10, z: 8 } as const;
export const CAMERA_MIN_DISTANCE = 6;
export const CAMERA_MAX_DISTANCE = 25;
export const CAMERA_MIN_POLAR_ANGLE = 0.2;             // rad – don't go below the board
export const CAMERA_MAX_POLAR_ANGLE = Math.PI / 2.2;   // rad – slight limit

// ── Lighting ──────────────────────────────────────────────────────
export const DIR_LIGHT_COLOR = 0xfff4e0;   // warm white
export const DIR_LIGHT_INTENSITY = 17.5;
export const AMBIENT_LIGHT_COLOR = 0xaa9480;
export const AMBIENT_LIGHT_INTENSITY = 1.0;
export const HEMISPHERE_SKY_COLOR = 0xffe0b2;
export const HEMISPHERE_GROUND_COLOR = 0x5a4030;
export const HEMISPHERE_INTENSITY = 0.9;
export const SHADOW_MAP_SIZE = 4096;

/** Cool fill light from opposite side to prevent pure-black shadows */
export const FILL_LIGHT_COLOR = 0xbb9977;
export const FILL_LIGHT_INTENSITY = 3.0;

// ── Materials ─────────────────────────────────────────────────────
/** Board deck frame — smooth but not glossy */
export const BOARD_ROUGHNESS = 0.85;
export const BOARD_METALNESS = 0.0;
export const BOARD_FRAME_COLOR = 0x4a3728;   // darker tint to distinguish from table
/** Board square surface — matte, non-reflective wood */
export const BOARD_SQUARE_ROUGHNESS = 0.92;
export const BOARD_SQUARE_METALNESS = 0.0;
/** Limit HDR environment reflections on board surfaces */
export const BOARD_ENV_MAP_INTENSITY = 0.1;

export const WHITE_CHECKER_ROUGHNESS = 0.1;
export const WHITE_CHECKER_METALNESS = 0;
/** Colour tint applied on top of the wood texture to tone down brightness */
export const WHITE_CHECKER_COLOR = 0x946556;
/** Limit HDR environment reflections so the light wood doesn't blow out */
export const WHITE_CHECKER_ENV_MAP_INTENSITY = 0.25;

export const BLACK_CHECKER_ROUGHNESS = 0.6;
export const BLACK_CHECKER_METALNESS = 0.02;
/** Colour tint to darken the wood texture for a richer, deeper tone */
export const BLACK_CHECKER_COLOR = 0x6b5818;
/** Limit HDR environment reflections on dark checkers */
export const BLACK_CHECKER_ENV_MAP_INTENSITY = 0.2;

// Light / dark square tint colours (used as `map` tint via `color`)
export const LIGHT_SQUARE_COLOR = 0xeacc20;
export const DARK_SQUARE_COLOR = 0x6b3a2a;

// ── Table ─────────────────────────────────────────────────────
export const TABLE_COLOR = 0x3a5a3a; // green felt
export const TABLE_SIZE = 20;
export const TABLE_NORMAL_SCALE = 1.0;
export const TABLE_AO_INTENSITY = 0.6;
/** Limits HDR environment reflections on the table surface */
export const TABLE_ENV_MAP_INTENSITY = 0.25;

// ── Table border (raised rails around the table) ──────────────────
/** Thickness of the border wall */
export const TABLE_BORDER_THICKNESS = 0.4;
/** Height of the border wall above the table surface */
export const TABLE_BORDER_HEIGHT = 0.35;
/** Half-extent of the inner play area (distance from center to inner edge of border) */
export const TABLE_BORDER_INNER_HALF = TABLE_SIZE / 2 - TABLE_BORDER_THICKNESS;
/** Sanded rail appearance */
export const TABLE_BORDER_ROUGHNESS = 0.75;
export const TABLE_BORDER_METALNESS = 0.02;
export const TABLE_BORDER_COLOR_TINT = 0x887766;

// ── Bloom post-processing ─────────────────────────────────────────
/** Luminance threshold — only pixels brighter than this receive bloom */
export const BLOOM_THRESHOLD = 0.85;
/** Overall bloom strength (higher = more glow) */
export const BLOOM_STRENGTH = 0.6;
/** Bloom blur radius (spread of the glow) */
export const BLOOM_RADIUS = 0.4;

// ── Active-team halo glow ─────────────────────────────────────────
/** Halo base colour for white team (darker warm amber) */
export const HALO_COLOR_WHITE = 0x8a6048;
/** Halo base colour for black team (darker muted gold) */
export const HALO_COLOR_BLACK = 0x7a6428;
/** HDR multiplier applied to halo colours so they exceed the bloom threshold */
export const HALO_HDR_SCALE = 2.0;
/** Radius of the glow disc (extends beyond checker edge for soft falloff) */
export const HALO_GLOW_RADIUS = CHECKER_RADIUS + 0.3;
/** Segment count for the circle geometry */
export const HALO_SEGMENTS = 64;
/** Base opacity of the halo glow (before pulse modulation) */
export const HALO_BASE_OPACITY = 0.55;
/** Amplitude of the breathing opacity pulse */
export const HALO_PULSE_AMPLITUDE = 0.2;
/** Speed of the breathing pulse (radians / second) */
export const HALO_PULSE_SPEED = 2.5;
/** Normalised inner radius where glow starts to fade (ratio of checker vs disc) */
export const HALO_INNER_RATIO = CHECKER_RADIUS / (CHECKER_RADIUS + 0.25) * 0.5;
/** Falloff exponent — higher = tighter glow around the checker edge */
export const HALO_FALLOFF = 2.0;

// ── Vignette post-processing ──────────────────────────────────────
export const VIGNETTE_OFFSET = 1.6;
export const VIGNETTE_DARKNESS = 0.8;

// ── Initial checker positions ─────────────────────────────────────
/**
 * Compute world-space X/Z from a board column/row (0-based).
 * Board center sits at the world origin.
 * Cell (0,0) is at (-3.5, -3.5), cell (7,7) at (+3.5, +3.5).
 */
function cellToWorld(col: number, row: number): FPVector3Type {
  const half = (BOARD_SIZE - 1) / 2; // 3.5
  const x = (col - half) * CELL_SIZE;
  const z = (row - half) * CELL_SIZE;
  // Y = top of board + half checker height
  const y = BOARD_HEIGHT / 2 + CHECKER_HEIGHT / 2;
  return FPVector3.FromFloat(x, y, z);
}

/**
 * Chapayev starting layout:
 * - White checkers occupy row 7 (bottom, closer to the player — white goes first)
 * - Black checkers occupy row 0 (top)
 */
export interface InitialCheckerPosition {
  readonly team: 'white' | 'black';
  readonly position: FPVector3Type;
}

function generateStartingPositions(): InitialCheckerPosition[] {
  const positions: InitialCheckerPosition[] = [];

  // White – row 7 (bottom from the camera's default viewpoint, z = +3.5)
  for (let col = 0; col < BOARD_SIZE; col++) {
    positions.push({ team: 'white', position: cellToWorld(col, 7) });
  }

  // Black – row 0 (top, z = -3.5)
  for (let col = 0; col < BOARD_SIZE; col++) {
    positions.push({ team: 'black', position: cellToWorld(col, 0) });
  }

  return positions;
}

export const INITIAL_POSITIONS: readonly InitialCheckerPosition[] = generateStartingPositions();

// ── Physics ───────────────────────────────────────────────────────
/** Simulation tick rate (ticks per second) */
export const PHYSICS_TICK_RATE = 60;

/** Fixed delta-time per physics tick (seconds) */
export const PHYSICS_DT = 1 / PHYSICS_TICK_RATE;

/** Friction coefficient – speed multiplier decay per second */
export const FRICTION = 3.0;

/** Coefficient of restitution for checker↔checker collisions */
export const RESTITUTION = 0.85;

/** Maximum flick impulse magnitude */
export const MAX_FLICK_FORCE = 40.0;

/** Speed threshold below which a checker is considered stopped */
export const STOP_THRESHOLD = 0.05;

/** Default checker mass (identical for all) */
export const CHECKER_MASS = 1.0;

/** Half-extent of the board (boundary for elimination check: −4 … +4) */
export const BOARD_HALF_EXTENT = BOARD_EXTENT / 2;

/**
 * Elimination boundary — a checker is only eliminated when its centre
 * clears the outer edge of the board rim/deck (board + rim overhang).
 */
export const BOARD_ELIM_HALF_EXTENT = BOARD_HALF_EXTENT + BOARD_RIM_WIDTH;

/** Multiplier converting drag-pixel distance to flick force */
export const FLICK_FORCE_MULTIPLIER = 8.0;

// ── Round transition ──────────────────────────────────────────────
/** Delay (in ticks) between round_over and the next round starting */
export const ROUND_TRANSITION_DELAY_TICKS = 120; // 2 seconds at 60 Hz

// ── Background music ──────────────────────────────────────────────
/** Volume for background music (0–1). Kept well below SFX (hit sounds play at 1.0). */
export const BGM_VOLUME = 0.12;
/** Cross-fade duration in seconds when transitioning between BGM tracks */
export const BGM_CROSSFADE_DURATION = 2.0;

// ── UI — Mode toggle ─────────────────────────────────────────────
/** Background when Aim mode is active (dark board tint) */
export const UI_BTN_AIM_BG = '#4a3728';
/** Background when Camera mode is active (table green) */
export const UI_BTN_CAM_BG = '#3a5a3a';
/** Button text / icon colour (warm white from directional light) */
export const UI_BTN_TEXT = '#fff4e0';
/** Button border (table rail tint) */
export const UI_BTN_BORDER = '#887766';
/** Hover / focus ring (golden light-square colour) */
export const UI_BTN_FOCUS = '#eacc20';

// ── Server / Auth ─────────────────────────────────────────────────
export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

/** Room / private match configuration */
export const ROOM_CONFIG = {
  codeTTLMs: 5 * 60 * 1000,
  codeLength: 6,
} as const;

