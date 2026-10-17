/**
 * @phalanx-engine/runtime — isomorphic match runtime (no DOM, no sockets).
 *
 * Status: Tasks 1–7, 6.5a and 6.5b are implemented. Games use
 * `defineComponent`, `defineCommands`, `defineGame` and `runLocalMatch`.
 * Local persistence is opt-in via `MatchStore` (`MemoryMatchStore`,
 * `IndexedDbMatchStore`) and `MatchRunner.resumeLocal`.
 * `StateHelpers`, `spawnWithId`, `CommandSchema`, `SaveHandler` and
 * `WorldScope` live in `@phalanx-engine/runtime/advanced`.
 * `MatchRunner.join` still throws `NotImplementedError` for Task 12. Design:
 * docs/design/runtime-api.md.
 *
 * @packageDocumentation
 */

import { setWorldModuleHost } from '@phalanx-engine/ecs';
import { worldModules } from './world/host.js';

export {
  ENGINE_SNAPSHOT_FORMAT,
  SNAPSHOT_MAGIC,
  REPLAY_FORMAT,
  DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS,
  DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS,
  DEFAULT_HASH_EVERY_TICKS,
  DEFAULT_INPUT_DELAY_TICKS,
  BOT_PLAYER_ID_PREFIX,
  SYSTEM_PLAYER_ID,
  botPlayerId,
  isBotPlayerId,
} from './constants.js';
export { NotImplementedError } from './notImplemented.js';

export * from './game/index.js';
export * from './state/index.js';
export * from './runner/index.js';
export * from './transport/index.js';
export * from './persistence/index.js';
export { defineComponent } from './world/defineComponent.js';
export type {
  DefinedComponent,
  DefineComponentOptions,
} from './world/defineComponent.js';
export { bindWorldSingletons } from './world/singletons.js';
export type { WorldSingletonHooks } from './world/singletons.js';

setWorldModuleHost(worldModules);
