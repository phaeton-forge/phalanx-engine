import type { EffectDef } from '../types';
import { DefinitionRegistry } from './DefinitionRegistry';

export class EffectRegistry extends DefinitionRegistry<EffectDef> {
  protected readonly registryName = 'EffectRegistry';
}
