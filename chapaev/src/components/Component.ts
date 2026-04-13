import { createComponentTypeRegistry } from 'phalanx-ecs';

/**
 * Component type symbols for type-safe component queries.
 * Using symbols ensures uniqueness and good performance for Map keys.
 */
export const ComponentType = createComponentTypeRegistry({
  Transform: 'Transform',
  Checker: 'Checker',
  Board: 'Board',
});

export type ComponentTypeKey = keyof typeof ComponentType;

