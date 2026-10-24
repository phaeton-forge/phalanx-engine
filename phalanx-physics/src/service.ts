import { defineService } from '@phalanx-engine/ecs';
import type { PhysicsWorld } from './PhysicsWorld.js';

/** Service key for the physics facade. `PhysicsWorld.attach` provides it. */
export const Physics = defineService<PhysicsWorld>('physics');
