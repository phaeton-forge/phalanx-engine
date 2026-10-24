import type { FixedPoint } from '@phalanx-engine/math';

export type AttributeInitializer =
  | FixedPoint
  | {
      base: FixedPoint;
      current?: FixedPoint;
    };

export interface InitialEffect {
  id: string;
  sourceEntityId?: number;
}

/** `world.addComponent(entity, AbilityOwner, init)` values. */
export interface AbilityOwnerInit {
  attributes?: Record<string, AttributeInitializer>;
  abilities?: readonly string[];
  tags?: readonly string[];
  effects?: readonly (string | InitialEffect)[];
}
