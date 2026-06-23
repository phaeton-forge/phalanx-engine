import type { IComponent } from '@phalanx-engine/ecs';
import type { ActiveEffectInstance } from '../types';
import { AbilitiesComponentType } from './AbilitiesComponentType';

export interface PendingEffectAdd {
  defId: string;
  sourceEntityId: number;
}

export class ActiveEffectsComponent implements IComponent {
  public readonly type = AbilitiesComponentType.ActiveEffects;
  public readonly queue: ActiveEffectInstance[] = [];
  public readonly pendingAdd: PendingEffectAdd[] = [];
}
