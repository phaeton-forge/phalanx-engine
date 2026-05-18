import type { AttributeDef } from '../types';

export function defineAttribute(def: AttributeDef): AttributeDef {
  return { ...def };
}
