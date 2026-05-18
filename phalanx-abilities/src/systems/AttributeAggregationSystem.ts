import { GameSystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import {
  ActiveEffectsComponent,
  AttributesComponent,
  AbilitiesComponentType,
} from '../components';
import type { AbilitySystemRegistries } from '../registry';
import type { ActiveEffectInstance, AttributeDef, EffectDef, ModifierOp } from '../types';

/**
 * Reusable per-tick buffer reused across entities to avoid per-entity allocations
 * when re-ordering the active effect queue. Sorted copy of the entity's queue.
 */
type OrderedEffectsBuffer = ActiveEffectInstance[];

/**
 * Resolves attribute `current` values from `base` + active effects.
 *
 * Determinism contract:
 *  - Modifiers are applied in FIFO `instanceId` ASC order.
 *  - Within a single effect, modifiers are applied in declaration order.
 *  - Clamping is applied last, per {@link AttributeDef.clamp}.
 *
 * Performance contract:
 *  - Skips entities with no dirty attributes (no sort, no allocations).
 *  - Resolves each effect's {@link EffectDef} at most once per entity per tick.
 *  - Reuses an internal buffer for the ordered queue (no per-entity array allocation).
 *  - `EffectApplicationSystem` is expected to insert into `ActiveEffectsComponent.queue`
 *    in `instanceId` ASC order so the sort is a no-op cheap pass; the system still
 *    sorts defensively to remain correct if test code or future systems push out of order.
 */
export class AttributeAggregationSystem extends GameSystem {
  private readonly orderedEffectsBuffer: OrderedEffectsBuffer = [];

  public constructor(private readonly registries: AbilitySystemRegistries) {
    super();
  }

  public override processTick(_tick: number): void {
    const entities = this.entityManager.queryEntities(AbilitiesComponentType.Attributes);
    const attributeDefs = this.registries.attributes.values();

    for (const entity of entities) {
      const attributes = entity.getComponent<AttributesComponent>(
        AbilitiesComponentType.Attributes
      );
      if (!attributes) {
        continue;
      }

      // Early exit: skip all work when no attribute is dirty on this entity.
      if (!hasAnyDirty(attributes.dirty)) {
        continue;
      }

      const activeEffects = entity.getComponent<ActiveEffectsComponent>(
        AbilitiesComponentType.ActiveEffects
      );
      const orderedEffects = this.takeOrderedEffects(activeEffects);
      // Resolve each EffectDef once per entity per tick instead of per dirty attribute.
      const resolvedEffectDefs = this.resolveEffectDefs(orderedEffects);

      for (let attributeIndex = 0; attributeIndex < attributes.dirty.length; attributeIndex++) {
        if (attributes.dirty[attributeIndex] === 0) {
          continue;
        }

        const attributeDef = attributeDefs[attributeIndex];
        if (!attributeDef) {
          throw new Error(`AttributeRegistry does not contain index ${attributeIndex}`);
        }

        let value = FP.FromRaw(attributes.base[attributeIndex]);
        for (let i = 0; i < resolvedEffectDefs.length; i++) {
          const effectDef = resolvedEffectDefs[i];
          for (const modifier of effectDef.modifiers) {
            if (modifier.attributeId !== attributeDef.id) {
              continue;
            }

            value = applyModifier(value, modifier.op, modifier.magnitude);
          }
        }

        attributes.current[attributeIndex] = FP.ToRaw(clampAttribute(value, attributeDef));
        attributes.dirty[attributeIndex] = 0;
      }
    }
  }

  /**
   * Returns the entity's effect queue ordered by `instanceId` ASC. Writes into
   * a system-owned buffer to avoid allocating a fresh array per entity per tick.
   * Sort is skipped when the queue is already sorted (the common case under
   * monotonic insertion by `EffectApplicationSystem`).
   */
  private takeOrderedEffects(
    activeEffects: ActiveEffectsComponent | undefined
  ): readonly ActiveEffectInstance[] {
    const buffer = this.orderedEffectsBuffer;
    buffer.length = 0;
    if (!activeEffects) {
      return buffer;
    }

    const queue = activeEffects.queue;
    let alreadySorted = true;
    for (let i = 0; i < queue.length; i++) {
      buffer.push(queue[i]);
      if (i > 0 && queue[i - 1].instanceId > queue[i].instanceId) {
        alreadySorted = false;
      }
    }

    if (!alreadySorted) {
      buffer.sort(byInstanceIdAsc);
    }

    return buffer;
  }

  private readonly resolvedEffectDefsBuffer: EffectDef[] = [];

  private resolveEffectDefs(orderedEffects: readonly ActiveEffectInstance[]): readonly EffectDef[] {
    const buffer = this.resolvedEffectDefsBuffer;
    buffer.length = 0;
    for (let i = 0; i < orderedEffects.length; i++) {
      buffer.push(this.registries.effects.get(orderedEffects[i].defId));
    }
    return buffer;
  }
}

function byInstanceIdAsc(a: ActiveEffectInstance, b: ActiveEffectInstance): number {
  return a.instanceId - b.instanceId;
}

function hasAnyDirty(dirty: Uint8Array): boolean {
  for (let i = 0; i < dirty.length; i++) {
    if (dirty[i] !== 0) {
      return true;
    }
  }
  return false;
}

function applyModifier(
  value: FixedPoint,
  op: ModifierOp,
  magnitude: FixedPoint
): FixedPoint {
  switch (op) {
    case 'Add':
      return FP.Add(value, magnitude);
    case 'Multiply':
      return FP.Mul(value, magnitude);
    case 'Override':
      return magnitude;
  }
}

function clampAttribute(value: FixedPoint, def: AttributeDef): FixedPoint {
  switch (def.clamp) {
    case 'both':
      return FP.Clamp(value, def.min, def.max);
    case 'min':
      return FP.Max(value, def.min);
    case 'max':
      return FP.Min(value, def.max);
    case 'none':
      return value;
  }
}
