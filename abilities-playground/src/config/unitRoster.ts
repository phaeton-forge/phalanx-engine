export type UnitKind = 'sphere' | 'cube' | 'cone';

export interface UnitRosterEntry {
  readonly kind: UnitKind;
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly radius: number;
  readonly mass: number;
  readonly stopRange: number;
  readonly maxHealth: number;
}

export const UNIT_ROSTER: readonly UnitRosterEntry[] = [
  // {
  //   kind: 'cube',
  //   offsetX: 0,
  //   offsetZ: 0,
  //   radius: 3,
  //   mass: 4,
  //   stopRange: 9,
  //   maxHealth: 180,
  // },
  {
    kind: 'sphere',
    offsetX: -6,
    offsetZ: 6,
    radius: 2.7,
    mass: 1.5,
    stopRange: 18,
    maxHealth: 90,
  },
  {
    kind: 'sphere',
    offsetX: 6,
    offsetZ: 6,
    radius: 2.7,
    mass: 1.5,
    stopRange: 18,
    maxHealth: 90,
  },
  // {
  //   kind: 'cone',
  //   offsetX: -11,
  //   offsetZ: -4,
  //   radius: 2.6,
  //   mass: 2,
  //   stopRange: 24,
  //   maxHealth: 110,
  // },
  // {
  //   kind: 'cone',
  //   offsetX: 11,
  //   offsetZ: -4,
  //   radius: 2.6,
  //   mass: 2,
  //   stopRange: 24,
  //   maxHealth: 110,
  // },
];
