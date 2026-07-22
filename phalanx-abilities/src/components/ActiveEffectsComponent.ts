import type { IComponent } from '@phalanx-engine/ecs';
import type { ActiveEffectInstance } from '../types';
import { AbilitiesComponentType } from './AbilitiesComponentType';

export interface PendingEffectAdd {
  defId: string;
  sourceEntityId: number;
  /** SetByCaller payload from `applyEffect`; `undefined`/`null` when the caller omitted it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- game-defined payload values, by design.
  setByCaller?: ReadonlyMap<string, any> | null;
}

export class ActiveEffectsComponent implements IComponent {
  public readonly type = AbilitiesComponentType.ActiveEffects;
  public readonly queue: ActiveEffectInstance[] = [];
  public readonly pendingAdd: PendingEffectAdd[] = [];
}
