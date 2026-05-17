import type { AbilityDef } from '../types';
import { DefinitionRegistry } from './DefinitionRegistry';

export class AbilityRegistry extends DefinitionRegistry<AbilityDef> {
  protected readonly registryName = 'AbilityRegistry';
}
