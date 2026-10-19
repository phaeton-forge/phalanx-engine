import type { IComponent } from '../Component.js';

/**
 * @internal Storage reset for pooled components (SoA rows).
 *
 * Game code uses the component lifecycle (`onCreate` / `onEnable` /
 * `onDisable` / `onDestroy`). `PoolManager` still calls `onSpawn` /
 * `onDespawn` for components that implement this interface. The interface
 * is exported. `isPoolableComponent` is not.
 */
export interface IPoolableComponent extends IComponent {
  /** Restore backing storage to constructor defaults (e.g. re-add the SoA row). */
  onSpawn(): void;
  /** Release transient/backing storage (e.g. remove the SoA row, hide the mesh). Idempotent. */
  onDespawn(): void;
}

/** Type guard used by PoolManager. */
export function isPoolableComponent(c: IComponent): c is IPoolableComponent {
  return (
    typeof (c as IPoolableComponent).onSpawn === 'function' &&
    typeof (c as IPoolableComponent).onDespawn === 'function'
  );
}
