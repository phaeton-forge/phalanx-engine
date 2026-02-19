import { TeamTag } from '../enums/TeamTag';

/**
 * Interface for entities that belong to a team
 * Follows Interface Segregation Principle
 */
export interface ITeamMember {
  readonly team: TeamTag;

  /**
   * Check if another team member is hostile
   */
  isHostileTo(other: ITeamMember): boolean;
}
