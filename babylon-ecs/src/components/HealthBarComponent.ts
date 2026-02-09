import type { IComponent } from './Component';
import { ComponentType } from './Component';

/**
 * HealthBarComponent - Marks an entity as needing a health bar display
 *
 * This component stores configuration for the health bar visualization.
 * The HealthBarSystem queries entities with this component to create
 * and manage health bar UI elements.
 */
export class HealthBarComponent implements IComponent {
  public readonly type = ComponentType.HealthBar;

  // Y offset above the entity mesh (in world units)
  private _heightOffset: number;

  constructor(heightOffset: number = 3.0) {
    this._heightOffset = heightOffset;
  }

  public get heightOffset(): number {
    return this._heightOffset;
  }
}

