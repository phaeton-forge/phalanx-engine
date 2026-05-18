import type { EntityManager } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import { AbilitiesComponentType, AttributesComponent } from '../components';
import type { AbilitySystemRegistries } from '../registry';

export interface AttributeValue {
  base: FixedPoint;
  current: FixedPoint;
}

export class AbilitySystemFacade {
  public constructor(
    private readonly entityManager: EntityManager,
    private readonly registries: AbilitySystemRegistries
  ) {}

  public initAttributesForEntity(entityId: number): AttributesComponent {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} does not exist`);
    }

    const existing = entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes);

    if (existing) {
      return existing;
    }

    const attributes = new AttributesComponent(this.registries.attributes.size);
    const defs = this.registries.attributes.values();

    for (let index = 0; index < defs.length; index++) {
      const rawDefault = FP.ToRaw(defs[index].default);
      attributes.base[index] = rawDefault;
      attributes.current[index] = rawDefault;
      // Mark every attribute dirty so AttributeAggregationSystem clamps the
      // seeded default value on the next tick. Without this, a default that
      // violates its own min/max would silently persist in `current`.
      attributes.dirty[index] = 1;
    }

    entity.addComponent(attributes);
    this.entityManager.onComponentAdded(entity, attributes.type);

    return attributes;
  }

  public getAttribute(entityId: number, attrId: string): AttributeValue {
    const value = this.tryGetAttribute(entityId, attrId);
    if (!value) {
      // Differentiate which precondition failed so callers get a useful message.
      const entity = this.entityManager.getEntity(entityId);
      if (!entity) {
        throw new Error(`Entity ${entityId} does not exist`);
      }
      if (!entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes)) {
        throw new Error(`Entity ${entityId} does not have AttributesComponent`);
      }
      throw new Error(`AttributeRegistry does not contain '${attrId}'`);
    }
    return value;
  }

  /**
   * Non-throwing read. Returns `undefined` when the entity is missing, has no
   * {@link AttributesComponent}, or the attribute id is not registered. Useful
   * for user-side damage pipelines that need to fall back to a neutral value
   * (e.g. `IncomingDamageMultiplier === 1`) when the target has no abilities
   * setup.
   */
  public tryGetAttribute(entityId: number, attrId: string): AttributeValue | undefined {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      return undefined;
    }

    const attributes = entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes);
    if (!attributes) {
      return undefined;
    }

    const index = this.registries.attributes.indexOfOrMinusOne(attrId);
    if (index === -1) {
      return undefined;
    }

    return {
      base: FP.FromRaw(attributes.base[index]),
      current: FP.FromRaw(attributes.current[index]),
    };
  }
}
