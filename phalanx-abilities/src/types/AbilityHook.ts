import type { ProvidedTarget } from './TargetSpec';

export interface AbilityActivationContext {
  abilityId: string;
  casterEntityId: number;
  resolvedTargets: number[];
  providedTarget?: ProvidedTarget;
  tick: number;
}

export type AbilityHook = (ctx: AbilityActivationContext) => void;
