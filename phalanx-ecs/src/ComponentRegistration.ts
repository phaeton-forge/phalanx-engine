import type { IComponent } from './Component.js';
import type { EntityManager } from './EntityManager.js';
import type {
  SoAFieldsOf,
  SoASchema,
  SoASchemaDefinition,
} from './SoASchema.js';

/**
 * A named SoA component registered on a world.
 *
 * Registration order is the order of `registerComponent` calls. That order
 * is the snapshot schema order for those stores and is part of `configHash`.
 */
export interface ComponentRegistration<
  S extends SoASchemaDefinition = SoASchemaDefinition,
> {
  readonly name: string;
  readonly schema: SoASchema<S>;
  readonly defaults: SoAFieldsOf<S>;
  readonly type: symbol;
  /**
   * Build a row for `entityId`. With `manager` the row is written to that
   * world's store now; without it, when the entity's world binds it.
   */
  create(
    entityId: number,
    values?: Readonly<Partial<Record<string, number | bigint>>>,
    manager?: EntityManager
  ): IComponent;
}
