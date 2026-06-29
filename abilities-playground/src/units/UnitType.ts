export const UnitType = {
  Sphere: 'sphere',
  Cube: 'cube',
  Support: 'support',
  Rocket: 'rocket',
} as const;

export type UnitType = (typeof UnitType)[keyof typeof UnitType];

/** Default hostile detection radius (world units); matches gameplay and debug ring. */
export const DEFAULT_UNIT_DETECTION_RANGE = 25;

/** Footprint on the formation grid, in cells (width = X, depth = Z). */
export interface UnitGridSize {
  readonly width: number;
  readonly depth: number;
}

export const UNIT_GRID_SIZE: Readonly<Record<UnitType, UnitGridSize>> = {
  [UnitType.Sphere]: { width: 1, depth: 1 },
  [UnitType.Support]: { width: 1, depth: 1 },
  [UnitType.Cube]: { width: 2, depth: 2 },
  [UnitType.Rocket]: { width: 2, depth: 1 },
} as const;
