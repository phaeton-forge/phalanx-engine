import { defineService } from '@phalanx-engine/ecs';
import type { AbilitySystem } from './createAbilitySystem.js';

/** Service key for the ability system. `createAbilitySystem` provides it. */
export const Abilities = defineService<AbilitySystem>('abilities');
