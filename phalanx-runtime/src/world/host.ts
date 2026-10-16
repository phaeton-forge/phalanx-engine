import type { WorldModuleHost } from '@phalanx-engine/ecs';
import {
  despawnOn,
  eachOn,
  restoreWorld,
  saveWorld,
  spawnOn,
} from './modules.js';

export const worldModules: WorldModuleHost = {
  save: saveWorld,
  restore: restoreWorld,
  spawn: spawnOn,
  despawn: despawnOn,
  each: eachOn,
};
