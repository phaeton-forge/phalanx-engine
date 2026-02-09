/**
 * Base Component interface
 * Components are data containers that can be attached to entities
 */
export interface IComponent {
  readonly type: symbol;
}

/**
 * Component type symbols for type-safe component queries
 * Using symbols ensures uniqueness and good performance for Map keys
 */
export const ComponentType = {
  Team: Symbol('Team'),
  Health: Symbol('Health'),
  Attack: Symbol('Attack'),
  Movement: Symbol('Movement'),
  Selectable: Symbol('Selectable'),
  Renderable: Symbol('Renderable'),
  UnitType: Symbol('UnitType'),
  Resource: Symbol('Resource'),
  Animation: Symbol('Animation'),
  Rotation: Symbol('Rotation'),
  AttackLock: Symbol('AttackLock'),
  Death: Symbol('Death'),
  PhysicsBody: Symbol('PhysicsBody'),
  HealthBar: Symbol('HealthBar'),
} as const;

export type ComponentTypeKey = keyof typeof ComponentType;
