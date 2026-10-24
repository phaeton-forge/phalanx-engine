# @phalanx-engine/protocol

The wire contract for Phalanx. Message types and the player-id constants
live here, and nothing else: no sockets, no simulation, no runtime
dependencies. `@phalanx-engine/client`, `@phalanx-engine/server`, and
`@phalanx-engine/runtime` depend on it. The client and the server
re-export the names games already import.

```bash
pnpm add @phalanx-engine/protocol
```

```ts
import {
  SYSTEM_PLAYER_ID,
  botPlayerId,
  isBotPlayerId,
  type MatchSnapshot,
  type MatchSnapshotRequest,
  type ServerDesyncEvent,
  type ServerSimHook,
  type SlotConfig,
} from '@phalanx-engine/protocol';
```

`SYSTEM_PLAYER_ID` is the id on runner-issued commands such as a
controller change. Bot ids are `bot:<slot>` (`BOT_PLAYER_ID_PREFIX`,
`botPlayerId`, `isBotPlayerId`).

Slot shapes (`HumanSlotConfig`, `BotSlotConfig`, `SlotConfig`,
`BotHostSide`) and `ServerRoomMatchConfig` are defined here. `SimMode`
and `MatchConfigBase` stay in the runtime.

`ServerSimHook` is the only type the relay uses to run a simulation.
`createServerSim` (`@phalanx-engine/runtime/server`, re-exported from
`@phalanx-engine/game/server`) returns one. The hook's types
(`ServerSimInfo`, `ServerSimGame`, `ServerSimMatchSpec`, `ServerSimRoom`,
`ServerSimMatch`, `ServerSimEvents`, `ServerSimPlayerEvents`,
`ServerDesyncEvent`, `MatchSnapshot`, `MatchSnapshotRequest`,
`EndMatchResult`) and `DEFAULT_INPUT_DELAY_TICKS` (`2`) live here. They
carry no engine types.

`PlayerCommand` is the server-stamped command (`type`, `tick`,
`playerId`, `data`, optional `sequence`). `SubmittedCommand` is what a
client puts in `submit-commands` (`type`, `data`, optional `sequence`).

An `*Event` name is an event payload. An `*Request` name is a
client-to-server request. Exceptions: `MatchResumeState` (the result of
`resumeMatch()`), `PlayerCommand` / `SubmittedCommand`,
`SubmitCommandsAck`, and `MatchLogEntry`.

## Events

| Event                    | Type                                 | Direction       |
| ------------------------ | ------------------------------------ | --------------- |
| `submit-commands`        | `SubmitCommandsEvent`                | client → server |
| `submit-commands-ack`    | `SubmitCommandsAck`                  | server → client |
| `player-command`         | `PlayerCommand`                      | client → server |
| `commands-batch`         | `CommandsBatchEvent`                 | server → client |
| `state-hash`             | `StateHashEvent`                     | client → server |
| `hash-comparison`        | `HashComparisonEvent`                | server → client |
| `desync`                 | `ServerDesyncEvent`                  | server → client |
| `match-snapshot`         | `MatchSnapshot`                      | server → client |
| `match-snapshot-request` | `MatchSnapshotRequest`               | client → server |
| `match-found`            | `MatchFoundEvent`                    | server → client |
| `countdown`              | `CountdownEvent`                     | server → client |
| `game-start`             | `GameStartEvent`                     | server → client |
| `tick-sync`              | `TickSyncEvent`                      | server → client |
| `player-disconnected`    | `PlayerDisconnectedEvent`            | server → client |
| `player-reconnected`     | `PlayerReconnectedEvent`             | server → client |
| `player-ready`           | `PlayerReadyEvent`                   | server → client |
| `player-absent`          | `PlayerAbsentEvent`                  | server → client |
| `reconnect-state`        | `ReconnectStateEvent`                | server → client |
| `reconnect-status`       | `ReconnectStatusEvent`               | server → client |
| `match-end`              | `MatchEndEvent`                      | server → client |
| `match-error`            | `MatchErrorEvent`                    | server → client |
| `game-paused`            | `GamePausedEvent`                    | server → client |
| `game-resumed`           | `GameResumedEvent`                   | server → client |
| `queue-status`           | `QueueStatusEvent`                   | server → client |
| `server-shutdown`        | `ServerShutdownEvent`                | server → client |
| `session-token`          | `SessionTokenEvent`                  | server → client |
| `session-superseded`     | `SessionSupersededEvent`             | server → client |
| `match-log`              | `MatchLogRequest`                    | client → server |
| `match-log-cancel`       | `MatchLogCancelRequest`              | client → server |
| `match-log-chunk`        | `MatchLogChunkEvent`                 | server → client |
| `match-log-error`        | `MatchLogErrorEvent`                 | server → client |
| `match-resume-state`     | `MatchResumeState`                   | server → client |
| `match-resume-error`     | `{ reason: MatchResumeErrorReason }` | server → client |
| `room-created`           | `RoomCreatedEvent`                   | server → client |
| `room-recovered`         | `RoomRecoveredEvent`                 | server → client |
| `room-error`             | `RoomErrorEvent`                     | server → client |
| `room-expired`           | `RoomExpiredEvent`                   | server → client |
| `room-cancelled`         | `RoomCancelledEvent`                 | server → client |

`desync` is one player and the tick that diverged (`playerId`, `tick`).
The server sends it to that player. `match-snapshot` is `{ tick, bytes,
requestId }` with `bytes` a `Uint8Array` of the snapshot for `tick`.
`match-snapshot-request` is `{ requestId }`.

`room-create.matchConfig` uses `ServerRoomMatchConfig`. `MatchState` is
the match lifecycle union on `MatchResumeState.state`.

## Not yet in protocol

These socket names are still untyped here.

Server → client: `command-ack`, `command-rejected`, `error`,
`queue-error`, `queue-left`, `match-waiting-for-players`,
`player-timeout`, `player-lagging`.

Client → server requests that are not in the table: `queue-join`,
`queue-leave`, `room-create`, `room-join`, `room-cancel`, `room-recover`,
`client-ready`, `pause-game`, `resume-game`, `match-resume`.

`player-command`, `submit-commands`, `state-hash`, `match-log`,
`match-log-cancel`, `desync`, `match-snapshot`, and
`match-snapshot-request` are already in the table.

## License

MIT
