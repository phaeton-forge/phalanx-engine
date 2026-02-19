import type { IComponent } from './Component';
import { ComponentType } from './Component';
/**
 * ResourceComponent - Manages player resources for unit deployment
 * Attached to player or game manager entities
 */
export class ResourceComponent implements IComponent {
  public readonly type = ComponentType.Resource;
  private _currentResources: number;
  private _baseGenerationRate: number;
  private _currentGenerationRate: number;
  constructor(initialResources: number = 0, baseGenerationRate: number = 10) {
    this._currentResources = initialResources;
    this._baseGenerationRate = baseGenerationRate;
    this._currentGenerationRate = baseGenerationRate;
  }
  public get resources(): number {
    return this._currentResources;
  }
  public get baseGenerationRate(): number {
    return this._baseGenerationRate;
  }
  public get currentGenerationRate(): number {
    return this._currentGenerationRate;
  }
  public setGenerationModifier(modifier: number): void {
    this._currentGenerationRate = this._baseGenerationRate * modifier;
  }
  public resetGenerationRate(): void {
    this._currentGenerationRate = this._baseGenerationRate;
  }
  public addResources(amount: number): void {
    this._currentResources += amount;
  }
  public spendResources(amount: number): boolean {
    if (this._currentResources >= amount) {
      this._currentResources -= amount;
      return true;
    }
    return false;
  }
  public canAfford(amount: number): boolean {
    return this._currentResources >= amount;
  }
  public generateResources(deltaTime: number): number {
    const generated = this._currentGenerationRate * deltaTime;
    this._currentResources += generated;
    return generated;
  }
}
