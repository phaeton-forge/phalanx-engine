const rawServerUrl: unknown = import.meta.env['VITE_SERVER_URL'];
export const SERVER_URL =
  typeof rawServerUrl === 'string' && rawServerUrl.length > 0
    ? rawServerUrl
    : 'http://localhost:3001';

export const networkConfig = {
  tickRate: 20,
  tickTimestep: 1 / 20,
};

export const cameraConfig = {
  height: 115,
  lookAheadOffset: 50,
  boundsPadding: 20,
};

export const arenaConfig = {
  width: 60,
  length: 400,
  minX: -30,
  maxX: 30,
  minZ: -200,
  maxZ: 200,
  team1SpawnZ: -180,
  team2SpawnZ: 180,
};

export const teamColors = {
  team1: '#3366FF',
  team2: '#FF3333',
};

export const tags = {
  team1: 'Team.1',
  team2: 'Team.2',
  illuminated: 'State.Illuminated',
  jammed: 'State.Jammed',
  cubeAura: 'Aura.Cube.Active',
};
