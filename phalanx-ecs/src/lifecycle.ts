/**
 * Optional component lifecycle. The engine calls these; game code does not.
 *
 * `onCreate` runs once, when the component is added to its entity.
 * `onEnable` runs on every pool spawn, on runtime `spawn`, and again after
 * runtime `restoreWorld` has written saved rows. It must not overwrite saved
 * fields; per-spawn writes belong in the entity `onSpawn`.
 * `onDisable` runs when a live entity returns to the pool or is despawned.
 * `onDestroy` runs from `dispose`, including pool drain.
 */
export interface ComponentLifecycle {
  onCreate?(): void;
  /** `'restore'` means snapshot bytes were just applied. Do not reseed. */
  onEnable?(reason?: 'restore'): void;
  onDisable?(): void;
  onDestroy?(): void;
}

export type ComponentLifecycleHook = keyof ComponentLifecycle;

export function invokeComponentHook(
  component: object,
  hook: ComponentLifecycleHook,
  reason?: 'restore'
): void {
  const record = component as Record<string, unknown>;
  const fn = record[hook];
  if (typeof fn !== 'function') return;
  if (hook === 'onEnable') {
    (fn as (enableReason?: 'restore') => void).call(component, reason);
    return;
  }
  (fn as () => void).call(component);
}

export function invokeComponentHooks(
  components: Iterable<object>,
  hook: ComponentLifecycleHook,
  reason?: 'restore'
): void {
  for (const component of components) {
    invokeComponentHook(component, hook, reason);
  }
}
