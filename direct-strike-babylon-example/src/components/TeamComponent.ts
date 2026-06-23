import { ComponentType } from './Component';
import { TeamTag } from '../enums/TeamTag';
import type { IResettableComponent } from '@phalanx-engine/ecs';

/**
 * TeamComponent - Defines team affiliation for an entity
 *
 * Implements IResettableComponent for pool support.
 */
export class TeamComponent implements IResettableComponent {
  public readonly type = ComponentType.Team;

  private _team: TeamTag;

  constructor(team: TeamTag = TeamTag.Neutral) {
    this._team = team;
  }

  public get team(): TeamTag {
    return this._team;
  }

  public setTeam(team: TeamTag): void {
    this._team = team;
  }

  /** IPoolable: reset to neutral */
  public reset(): void {
    this._team = TeamTag.Neutral;
  }

  /** IResettableComponent: reinitialize with new team */
  public reinitialize(team: TeamTag): void {
    this._team = team;
  }

  /**
   * Check if another team component represents a hostile entity
   */
  public isHostileTo(other: TeamComponent): boolean {
    if (this._team === TeamTag.Neutral || other.team === TeamTag.Neutral) {
      return false;
    }
    return this._team !== other.team;
  }

  /**
   * Check if this entity belongs to the player's team
   */
  public isPlayerTeam(): boolean {
    return this._team === TeamTag.Team1;
  }
}
