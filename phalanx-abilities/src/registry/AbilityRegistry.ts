import type { AbilityDef } from '../types/index.js';
import { DefinitionRegistry } from './DefinitionRegistry.js';

export class AbilityRegistry extends DefinitionRegistry<AbilityDef> {
  protected readonly registryName = 'AbilityRegistry';
}
