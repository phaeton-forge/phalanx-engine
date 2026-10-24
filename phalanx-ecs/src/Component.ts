import type { EntityManager } from './EntityManager.js';

/**
 * Base Component interface
 * Components are data containers that can be attached to entities
 */
export interface IComponent {
  readonly type: symbol;
}

/**
 * @internal A component whose data lives in a world's store. The entity
 * binds it once the owning world is known; binding is idempotent.
 */
export interface IStoreBoundComponent extends IComponent {
  _bind(manager: EntityManager): void;
  _boundManager(): EntityManager | null;
}

/** @internal */
export function isStoreBound(
  component: IComponent
): component is IStoreBoundComponent {
  return (
    typeof (component as Partial<IStoreBoundComponent>)._bind === 'function'
  );
}
