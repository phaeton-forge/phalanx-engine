/**
 * Low-level snapshot helpers. Games use `world.save` / `world.restore`.
 * These functions keep the historical section bytes for a hand-written
 * `GameState`.
 *
 * @packageDocumentation
 */

export { StateHelpers } from '../helpers/StateHelpers.js';
export { spawnWithId } from '../helpers/entities.js';
export { rebuildBroadphaseFromTransforms } from '../helpers/physics.js';
export { WorldScope } from '../runner/WorldScope.js';
export {
  DebugPanel,
  PoolManager,
  SoAComponentStore,
  TickFrameManager,
  TYPED_ARRAY_CONSTRUCTORS,
  nextEntityId,
  setEntityIdCounter,
  setWorldModuleHost,
} from '@phalanx-engine/ecs';
export type {
  DebugPanelConfig,
  TickFrameManagerConfig,
} from '@phalanx-engine/ecs';
export type {
  CommandEnvelope,
  CommandSchema,
  TransportCommand,
} from '../game/commands.js';
export type {
  Transport,
  TransportCatchUp,
  TransportJoin,
  TransportKind,
} from '../transport/Transport.js';
export type {
  SaveHandler,
  SaveSpec,
  StateMigration,
} from '../state/GameState.js';
