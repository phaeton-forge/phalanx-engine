import type { AttributeDef } from '../types';
import { DefinitionRegistry } from './DefinitionRegistry';

export class AttributeRegistry extends DefinitionRegistry<AttributeDef> {
  protected readonly registryName = 'AttributeRegistry';

  /**
   * O(1) lookup of the attribute's storage index. Throws when the attribute
   * is not registered. Hot path: called by {@link AbilitySystemFacade.getAttribute}
   * and by effect-application code that resolves `Modifier.attributeId` to an index.
   */
  public indexOf(id: string): number {
    const index = this.indexOfOrMinusOne(id);
    if (index === -1) {
      throw new Error(`${this.registryName} does not contain '${id}'`);
    }

    return index;
  }
}
