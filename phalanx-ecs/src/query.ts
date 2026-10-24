import type { Entity } from './Entity.js';
import type {
  ObjectComponentDef,
  TransientComponentDef,
} from './defineComponent.js';

/**
 * A component accepted by `world.query` and `world.queryAny`: any result
 * of `defineComponent`. Structural, because a SoA definition is invariant
 * in its schema.
 */
export interface QueryComponent {
  readonly kind: 'soa' | 'object' | 'transient';
  readonly name: string;
  readonly type: symbol;
}

/**
 * Query slot for one component. A SoA component yields its row index in
 * the store; an object or transient component yields the stored value.
 * A component widened to `QueryComponent` yields `number | object`.
 */
type QueryValue<C> = C extends { readonly kind: 'soa' }
  ? number
  : C extends ObjectComponentDef<infer T>
    ? T
    : C extends TransientComponentDef<infer T>
      ? T
      : number | object;

/** `world.query` row: the entity, then one slot per component. */
export type QueryRow<Cs extends readonly QueryComponent[]> = [
  Entity,
  ...{ [K in keyof Cs]: QueryValue<Cs[K]> },
];

/** `world.queryAny` row. An absent component is `undefined`. */
export type QueryAnyRow<Cs extends readonly QueryComponent[]> = [
  Entity,
  ...{ [K in keyof Cs]: QueryValue<Cs[K]> | undefined },
];
