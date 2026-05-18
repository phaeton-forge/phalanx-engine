import type { TargetSpec } from './TargetSpec';

export interface AuraComponent {
  abilityId: string;
  target: TargetSpec;
  effectIds: string[];
  periodTicks: number;
  nextTick: number;
  ownerEntityId: number;
}
