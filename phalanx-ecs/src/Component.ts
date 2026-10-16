/**
 * Base Component interface
 * Components are data containers that can be attached to entities
 */
export interface IComponent {
  readonly type: symbol;
}

/**
 * Helper function to create a component type registry
 * Game developers can use this to create their own component type registries
 *
 * Example:
 * ```typescript
 * export const ComponentType = createComponentTypeRegistry({
 *   Health: 'Health',
 *   Movement: 'Movement',
 *   Attack: 'Attack',
 * });
 * ```
 */
export function createComponentTypeRegistry<T extends Record<string, string>>(
  types: T
): { [K in keyof T]: symbol } {
  const registry: { [K in keyof T]?: symbol } = {};
  for (const key of Object.keys(types) as (keyof T)[]) {
    const name = types[key];
    registry[key] = Symbol(name);
  }
  return registry as { [K in keyof T]: symbol };
}
