import type { AttributeDef } from '../types';
import { DefinitionRegistry } from './DefinitionRegistry';

export class AttributeRegistry extends DefinitionRegistry<AttributeDef> {
  protected readonly registryName = 'AttributeRegistry';

  public indexOf(id: string): number {
    const index = this.values().findIndex(def => def.id === id);
    if (index === -1) {
      throw new Error(`${this.registryName} does not contain '${id}'`);
    }

    return index;
  }
}
