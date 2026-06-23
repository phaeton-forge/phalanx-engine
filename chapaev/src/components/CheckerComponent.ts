import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './Component.ts';
import { TeamTag } from '../enums/TeamTag.ts';

/**
 * CheckerComponent — data-only marker identifying a checker piece.
 */
export class CheckerComponent implements IComponent {
  public readonly type = ComponentType.Checker;
  public readonly team: TeamTag;
  public isAlive: boolean;

  constructor(team: TeamTag, isAlive: boolean = true) {
    this.team = team;
    this.isAlive = isAlive;
  }
}


