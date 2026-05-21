export interface UnitSpawnEntry {
  type: 'sphere' | 'cube' | 'cone';
  position: { x: number; z: number };
}

export const UNIT_ROSTER: { team1: UnitSpawnEntry[]; team2: UnitSpawnEntry[] } =
  {
    team1: [
      { type: 'sphere', position: { x: -10, z: 0 } },
      { type: 'sphere', position: { x: 0, z: 0 } },
      { type: 'sphere', position: { x: 10, z: 0 } },
      { type: 'cube', position: { x: 0, z: -12 } },
      { type: 'cone', position: { x: 0, z: -20 } },
    ],
    team2: [
      { type: 'sphere', position: { x: -10, z: 0 } },
      { type: 'sphere', position: { x: 0, z: 0 } },
      { type: 'sphere', position: { x: 10, z: 0 } },
      { type: 'cube', position: { x: 0, z: 12 } },
      { type: 'cone', position: { x: 0, z: 20 } },
    ],
  };
