import type { IComponent } from './Component';
import { ComponentType } from './Component';

/**
 * Unit types available in the game
 */
export const UnitType = {
  Sphere: 'sphere', // 1x1 grid space (DEPRECATED - replaced by Mutant)
  Prisma: 'prisma', // 2x2 grid space
  Lance: 'lance', // 1x2 grid space
  Mutant: 'mutant', // 1x1 grid space - melee unit with animations
} as const;

export type UnitType = (typeof UnitType)[keyof typeof UnitType];

/**
 * Grid size configuration for each unit type
 * This is the single source of truth for unit grid dimensions.
 * Used by FormationGridSystem and UnitTypeComponent.
 */
export const UnitGridSize: Record<UnitType, { width: number; height: number }> =
  {
    [UnitType.Sphere]: { width: 1, height: 1 },
    [UnitType.Prisma]: { width: 2, height: 2 },
    [UnitType.Lance]: { width: 2, height: 1 },
    [UnitType.Mutant]: { width: 2, height: 2 },
  };

/**
 * UnitTypeComponent - Stores the type of unit and its grid footprint
 */
export class UnitTypeComponent implements IComponent {
  public readonly type = ComponentType.UnitType;

  public readonly unitType: UnitType;
  public readonly gridWidth: number;
  public readonly gridHeight: number;

  constructor(unitType: UnitType) {
    this.unitType = unitType;
    const size = UnitGridSize[unitType];
    this.gridWidth = size.width;
    this.gridHeight = size.height;
  }

  /**
   * Get the number of grid cells this unit occupies
   */
  public getGridCellCount(): number {
    return this.gridWidth * this.gridHeight;
  }
}
