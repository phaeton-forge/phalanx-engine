import type { IComponent } from '../Component';
import type { IPoolable } from './IPoolable';

/**
 * Extended contract for components that support pooling with re-initialization.
 * Components implement this to allow reset + reinitialize without allocation.
 */
export interface IResettableComponent extends IComponent, IPoolable {
  /**
   * Reset and re-initialize the component with new parameter values.
   * The argument types depend on the concrete component.
   */
  reinitialize(...args: unknown[]): void;
}
