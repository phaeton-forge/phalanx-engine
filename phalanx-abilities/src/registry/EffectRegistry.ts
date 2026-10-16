import type { EffectDef } from '../types/index.js';
import { DefinitionRegistry } from './DefinitionRegistry.js';

export class EffectRegistry extends DefinitionRegistry<EffectDef> {
  protected readonly registryName = 'EffectRegistry';
}
