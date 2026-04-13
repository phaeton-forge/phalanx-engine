export const TeamTag = {
  White: 'white',
  Black: 'black',
} as const;

export type TeamTag = (typeof TeamTag)[keyof typeof TeamTag];



