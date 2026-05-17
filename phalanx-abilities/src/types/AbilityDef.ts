import type { TargetSpec } from './TargetSpec';

export interface AbilityDef {
  id: string;
  costEffectId?: string;
  cooldownEffectId?: string;
  tagsRequired?: string[];
  activationBlockedTags?: string[];
  selfEffectIds?: string[];
  targetEffectIds?: string[];
  target: TargetSpec;
  hookId?: string;
}
