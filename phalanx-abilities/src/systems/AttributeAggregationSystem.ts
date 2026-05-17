import { GameSystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import { ActiveEffectsComponent, AttributesComponent, AbilitiesComponentType } from '../components';
import type { AbilitySystemRegistries } from '../registry';
import type { AttributeDef, ModifierOp } from '../types';

export class AttributeAggregationSystem extends GameSystem {
  public constructor(private readonly registries: AbilitySystemRegistries) {
    super();
  }

  public override processTick(_tick: number): void {
    const entities = this.entityManager.queryEntities(AbilitiesComponentType.Attributes);
    const attributeDefs = this.registries.attributes.values();

    for (const entity of entities) {
      const attributes = entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes);
      if (!attributes) {
        continue;
      }

      const activeEffects = entity.getComponent<ActiveEffectsComponent>(
        AbilitiesComponentType.ActiveEffects
      );
      const orderedEffects = activeEffects
        ? [...activeEffects.queue].sort((a, b) => a.instanceId - b.instanceId)
        : [];

      for (let attributeIndex = 0; attributeIndex < attributes.dirty.length; attributeIndex++) {
        if (attributes.dirty[attributeIndex] === 0) {
          continue;
        }

        const attributeDef = attributeDefs[attributeIndex];
        if (!attributeDef) {
          throw new Error(`AttributeRegistry does not contain index ${attributeIndex}`);
        }

        let value = FP.FromRaw(attributes.base[attributeIndex]);
        for (const activeEffect of orderedEffects) {
          const effectDef = this.registries.effects.get(activeEffect.defId);
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
