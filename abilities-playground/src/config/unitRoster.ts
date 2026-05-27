export type UnitKind = 'sphere' | 'cube' | 'cone';

export interface UnitSpawnOffset {
  readonly offsetX: number;
  readonly offsetZ: number;
}

export interface UnitRosterEntry {
  readonly kind: UnitKind;
  readonly spawns: Readonly<Record<0 | 1, UnitSpawnOffset>>;
  readonly radius: number;
  readonly mass: number;
  readonly stopRange: number;
  readonly maxHealth: number;
}

export const UNIT_ROSTER: readonly UnitRosterEntry[] = [
  // {
  //   kind: 'cube',
  //   spawns: {
  //     0: { offsetX: 0, offsetZ: 0 },
  //     1: { offsetX: 4, offsetZ: 2 },
  //   },
  //   radius: 3,
  //   mass: 4,
  //   stopRange: 9,
  //   maxHealth: 180,
  // },
  {
    kind: 'sphere',
    spawns: {
      0: { offsetX: -18, offsetZ: 5 },
      1: { offsetX: 12, offsetZ: 8 },
    },
    radius: 2.7,
    mass: 1.5,
    stopRange: 18,
    maxHealth: 90,
  },
  {
    kind: 'sphere',
    spawns: {
      0: { offsetX: 8, offsetZ: 14 },
      1: { offsetX: -15, offsetZ: 3 },
    },
    radius: 2.7,
    mass: 1.5,
    stopRange: 18,
    maxHealth: 90,
  },
  // {
  //   kind: 'cone',
  //   spawns: {
  //     0: { offsetX: -11, offsetZ: -4 },
  //     1: { offsetX: 6, offsetZ: 10 },
  //   },
  //   radius: 2.6,
  //   mass: 2,
  //   stopRange: 24,
  //   maxHealth: 110,
  // },
  // {
  //   kind: 'cone',
  //   spawns: {
  //     0: { offsetX: 11, offsetZ: -4 },
  //     1: { offsetX: -9, offsetZ: 12 },
  //   },
  //   radius: 2.6,
  //   mass: 2,
  //   stopRange: 24,
  //   maxHealth: 110,
  // },
];
