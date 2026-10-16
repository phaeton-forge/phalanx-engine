import type { GameWorld } from '@phalanx-engine/ecs';
import type { ComponentSchemaHash } from '../state/snapshot.js';

/**
 * Registered components in registration order, with each field's name and
 * type in declaration order. This is the `configHash` component record.
 */
export function componentSchemaHashes(world: GameWorld): ComponentSchemaHash[] {
  const records: ComponentSchemaHash[] = [];
  for (const component of world.registeredComponents()) {
    const fields: [string, string][] = [];
    for (const fieldName of component.schema.fieldNames) {
      const fieldType = component.schema.fieldTypes[fieldName];
      if (fieldType === undefined) {
        throw new Error(
          `component '${component.name}' is missing field '${fieldName}'`
        );
      }
      fields.push([fieldName, fieldType]);
    }
    records.push({ name: component.name, fields });
  }
  return records;
}
