/**
 * @phalanx-engine/protocol — client↔server wire contract.
 *
 * Message types and player-id constants only. No sockets, no simulation,
 * no runtime dependencies. Private until the synchronized 0.3.0 release.
 *
 * @packageDocumentation
 */

export { DEFAULT_INPUT_DELAY_TICKS } from './constants.js';

export {
  BOT_PLAYER_ID_PREFIX,
  SYSTEM_PLAYER_ID,
  botPlayerId,
  isBotPlayerId,
} from './playerIds.js';

export type {
  BotHostSide,
  BotSlotConfig,
  HumanSlotConfig,
  ServerRoomMatchConfig,
  SlotConfig,
} from './matchConfig.js';

export type {
  CommandsBatchEvent,
  PlayerCommand,
  SubmitCommandsAck,
  SubmitCommandsEvent,
  SubmittedCommand,
} from './messages/commands.js';

export type { HashComparisonEvent, StateHashEvent } from './messages/hash.js';

export type {
  MatchLogCancelRequest,
  MatchLogChunkEvent,
  MatchLogEntry,
  MatchLogErrorEvent,
  MatchLogErrorReason,
  MatchLogRequest,
} from './messages/log.js';

export type {
  CountdownEvent,
  GamePausedEvent,
  GameResumedEvent,
  GameStartEvent,
  MatchEndEvent,
  MatchErrorEvent,
  MatchFoundEvent,
  MatchPlayerInfo,
  MatchState,
  PlayerAbsentEvent,
  PlayerDisconnectedEvent,
  PlayerReadyEvent,
  PlayerReconnectedEvent,
  QueueStatusEvent,
  ReconnectStateEvent,
  ReconnectStatusEvent,
  ServerShutdownEvent,
  TickSyncEvent,
} from './messages/match.js';

export type {
  MatchResumeErrorReason,
  MatchResumeState,
} from './messages/resume.js';

export type {
  SessionSupersededEvent,
  SessionTokenEvent,
} from './messages/session.js';

export type {
  RoomCancelledEvent,
  RoomCreatedEvent,
  RoomErrorEvent,
  RoomExpiredEvent,
  RoomRecoveredEvent,
} from './messages/room.js';

export type {
  EndMatchResult,
  MatchSnapshot,
  MatchSnapshotRequest,
  ServerDesyncEvent,
  ServerSimEvents,
  ServerSimGame,
  ServerSimPlayerEvents,
  ServerSimHook,
  ServerSimInfo,
  ServerSimMatch,
  ServerSimMatchSpec,
  ServerSimRoom,
} from './simHook.js';
