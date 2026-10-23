import type { StateReader, StateWriter } from '@phalanx-engine/ecs';
import { defineComponent } from '@phalanx-engine/ecs';

/** Raw fixed-point attribute values, indexed by the world's attribute registry. */
export interface AttributesState {
  readonly base: BigInt64Array;
  readonly current: BigInt64Array;
  readonly dirty: Uint8Array;
}

export function createAttributesState(attributeCount: number): AttributesState {
  if (!Number.isInteger(attributeCount) || attributeCount < 0) {
    throw new Error(
      `attributeCount must be a non-negative integer, got ${attributeCount}`
    );
  }
  return {
    base: new BigInt64Array(attributeCount),
    current: new BigInt64Array(attributeCount),
    dirty: new Uint8Array(attributeCount),
  };
}

/** Count, then `base`, `current` (`i64`) and `dirty` (`u8`) per index ascending. */
export function saveAttributes(
  attributes: AttributesState,
  w: StateWriter
): void {
  const count = attributes.base.length;
  if (
    attributes.current.length !== count ||
    attributes.dirty.length !== count
  ) {
    throw new Error('writeAbilities: attribute arrays have different lengths');
  }
  w.varint(count);
  for (let index = 0; index < count; index += 1) {
    const base = attributes.base[index];
    const current = attributes.current[index];
    const dirty = attributes.dirty[index];
    if (base === undefined || current === undefined || dirty === undefined) {
      throw new Error('writeAbilities: attribute index out of range');
    }
    w.i64(base);
    w.i64(current);
    w.u8(dirty);
  }
}

export function loadAttributes(r: StateReader): AttributesState {
  const count = r.varint();
  const attributes = createAttributesState(count);
  for (let index = 0; index < count; index += 1) {
    attributes.base[index] = r.i64();
    attributes.current[index] = r.i64();
    attributes.dirty[index] = r.u8();
  }
  return attributes;
}

export const Attributes = defineComponent<AttributesState>('Attributes', {
  kind: 'object',
  create: () => createAttributesState(0),
  save: saveAttributes,
  load: loadAttributes,
});

export function copyAttributes(
  target: AttributesState,
  source: AttributesState
): void {
  target.base.set(source.base);
  target.current.set(source.current);
  target.dirty.set(source.dirty);
}
