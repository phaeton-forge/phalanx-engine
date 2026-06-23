import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './Component.ts';

/**
 * BoardComponent — marker component for the board entity.
 */
export class BoardComponent implements IComponent {
  public readonly type = ComponentType.Board;
}

