/**
 * @phalanx-engine/runtime — isomorphic match runtime (no sockets).
 * The debug panel is the only DOM surface. Simulation code stays DOM-free.
 *
 * Status: Tasks 1–7, 7.1, 6.5a and 6.5b are implemented. Games use
 * `defineComponent`, `defineCommands`, `defineGame` and `runLocalMatch`.
 * World snapshots and spawning are plain functions: `saveWorld`,
 * `restoreWorld`, `spawn`, `despawn`, `each`. Importing this module does
 * no work.
 * Local persistence is opt-in via `MatchStore` (`MemoryMatchStore`,
 * `IndexedDbMatchStore`) and `MatchRunner.resumeLocal`.
 * `StateHelpers`, `spawnWithId`, `CommandSchema`, `SaveHandler` and
 * `WorldScope` live in `@phalanx-engine/runtime/advanced`.
 * `MatchRunner.join` still throws `NotImplementedError` for Task 12. Design:
 * docs/design/runtime-api.md.
 *
 * @packageDocumentation
 */

export {
  ENGINE_SNAPSHOT_FORMAT,
  SNAPSHOT_MAGIC,
  REPLAY_FORMAT,
  DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS,
  DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS,
  DEFAULT_HASH_EVERY_TICKS,
  DEFAULT_INPUT_DELAY_TICKS,
} from './constants.js';
export {
  BOT_PLAYER_ID_PREFIX,
  SYSTEM_PLAYER_ID,
  botPlayerId,
  isBotPlayerId,
} from '@phalanx-engine/protocol';
export { NotImplementedError } from './notImplemented.js';

export { defineGame } from './game/defineGame.js';
export { defineCommands } from './game/defineCommands.js';
export type {
  CommandFieldSpec,
  CommandFieldType,
  CommandFromSpec,
  CommandSchemaHash,
  CommandSpec,
  DefineCommandsOptions,
  DefinedCommands,
} from './game/defineCommands.js';
export { rejectCommand, isCommandRejection } from './game/commands.js';
export type {
  JsonValue,
  GameCommand,
  StampedCommand,
  CommandRejection,
} from './game/commands.js';
export type {
  SimMode,
  BotHostSide,
  HumanSlotConfig,
  BotSlotConfig,
  SlotConfig,
  MatchConfigBase,
  SlotInfo,
  BotSlotInfo,
} from './game/MatchConfig.js';
export type {
  StartContext,
  GameContext,
  SimWorld,
  MatchOutcome,
  MatchOutcomeWin,
  MatchOutcomeDraw,
  CommandHandlerMap,
  OnCommand,
  GameComponent,
  GameDefinition,
  AnyGameDefinition,
  ConfigOf,
  CommandOf,
  SimOf,
  StampedCommandOf,
} from './game/GameDefinition.js';
export * from './state/index.js';
export * from './runner/index.js';
export { LocalTransport } from './transport/LocalTransport.js';
export type {
  LocalTransportOptions,
  PersistenceFlushReason,
} from './transport/LocalTransport.js';
export * from './persistence/index.js';
export { defineComponent } from './world/defineComponent.js';
export type {
  DefinedComponent,
  DefineComponentOptions,
} from './world/defineComponent.js';
export {
  saveWorld,
  restoreWorld,
  spawn,
  despawn,
  each,
} from './world/modules.js';
export { bindWorldSingletons } from './world/singletons.js';
export type { WorldSingletonHooks } from './world/singletons.js';
export { DebugDataProvider } from './host/debug/DebugDataProvider.js';
export { attachDebug } from './host/debug/attachDebug.js';
export type {
  DebugSnapshot,
  DebugEntitySnapshot,
  DebugComponentSnapshot,
  DebugSoAStoreSnapshot,
  DebugPoolSnapshot,
  DebugDataProviderConfig,
} from './host/debug/types.js';
export type {
  AttachDebugOptions,
  DebugAttachment,
} from './host/debug/attachDebug.js';
