import type { AttributeDef } from '../types/index.js';

export function defineAttribute(def: AttributeDef): AttributeDef {
  return { ...def };
}
