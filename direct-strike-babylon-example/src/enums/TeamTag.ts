/**
 * TeamTag - Defines team affiliations for entities
 * Used to determine friendly/hostile relationships
 */
export const TeamTag = {
  Neutral: 0,
  Team1: 1, // Player team
  Team2: 2, // Enemy team
} as const;

export type TeamTag = (typeof TeamTag)[keyof typeof TeamTag];
