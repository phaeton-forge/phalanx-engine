import type { IComponent } from 'phalanx-ecs';
import { ComponentType } from './Component';

export class TargetingComponent implements IComponent {
  public readonly type = ComponentType.Targeting;
  public attackTargetId: number | null = null;
  public illuminatedTargetIds: [number | null, number | null] = [null, null];
  public jammedTargetId: number | null = null;
}
