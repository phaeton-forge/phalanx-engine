import type { IComponent } from 'phalanx-ecs';
import { ComponentType } from './Component';

export class LifecycleComponent implements IComponent {
  public readonly type = ComponentType.Lifecycle;
  public alive = true;
  public dyingSinceTick: number | null = null;
  public removable = false;
}
