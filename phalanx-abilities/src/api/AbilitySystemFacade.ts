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
    }

    entity.addComponent(attributes);
    this.entityManager.onComponentAdded(entity, attributes.type);

    return attributes;
  }

  public getAttribute(entityId: number, attrId: string): AttributeValue {
    const entity = this.entityManager.getEntity(entityId);

    if (!entity) {
      throw new Error(`Entity ${entityId} does not exist`);
    }

    const attributes = entity.getComponent<AttributesComponent>(AbilitiesComponentType.Attributes);

    if (!attributes) {
      throw new Error(`Entity ${entityId} does not have AttributesComponent`);
    }

    const index = this.registries.attributes.indexOf(attrId);

    return {
      base: FP.FromRaw(attributes.base[index]),
      current: FP.FromRaw(attributes.current[index]),
    };
  }
}
