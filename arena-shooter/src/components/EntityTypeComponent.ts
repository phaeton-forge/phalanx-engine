import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './ComponentType.ts';

export type EntityKind = 'player' | 'enemy' | 'projectile' | 'pickup' | 'wall';

export class EntityTypeComponent implements IComponent {
  public readonly type = ComponentType.EntityType;

  public kind: EntityKind;

  constructor(kind: EntityKind) {
    this.kind = kind;
  }
}
