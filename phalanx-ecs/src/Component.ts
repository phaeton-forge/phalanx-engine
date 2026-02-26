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
  const registry: any = {};
  for (const key in types) {
    registry[key] = Symbol(types[key]);
  }
  return registry;
}
