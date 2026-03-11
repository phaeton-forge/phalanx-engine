import type { IComponent } from '../Component';
import type { IPoolable } from './IPoolable';

export interface IResettableComponent extends IComponent, IPoolable {
  reinitialize(...args: any[]): void;
}
