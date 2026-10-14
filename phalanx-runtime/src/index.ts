/**
 * @phalanx-engine/runtime — isomorphic match runtime (no DOM, no sockets).
 *
 * Status: skeleton. Contracts are final for Tasks 2–13; members that throw
 * `NotImplementedError` name the task that implements them. Design:
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
  BOT_PLAYER_ID_PREFIX,
  botPlayerId,
  isBotPlayerId,
} from './constants.js';
export { NotImplementedError } from './notImplemented.js';

export * from './game/index.js';
export * from './state/index.js';
export * from './helpers/index.js';
export * from './runner/index.js';
export * from './transport/index.js';
