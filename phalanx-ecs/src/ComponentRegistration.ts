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
   * Attach a row. `manager` is the world that owns the row. When it is
   * omitted, the process-wide `SoAComponent` context is used.
   */
  create(
    entityId: number,
    values?: Readonly<Partial<Record<string, number | bigint>>>,
    manager?: EntityManager
  ): IComponent;
}
