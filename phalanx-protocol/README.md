# @phalanx-engine/protocol

Wire contract for the Phalanx client and server. Message types and the
player-id constants (`SYSTEM_PLAYER_ID`, `BOT_PLAYER_ID_PREFIX`,
`botPlayerId`, `isBotPlayerId`) live here. The package has no runtime
dependencies.

`@phalanx-engine/client`, `@phalanx-engine/server`, and
`@phalanx-engine/runtime` depend on it. Runtime and the server re-export
the names games already import. The package is private (`0.3.0`,
`phalanx.layer: contracts`) until the synchronized release.

Slot types (`HumanSlotConfig`, `BotSlotConfig`, `SlotConfig`,
`BotHostSide`) and `ServerRoomMatchConfig` are defined here.
`SimMode` and `MatchConfigBase` stay in the runtime.

`PlayerCommand` is the server-stamped command (`type`, `tick`, `playerId`,
`data`, optional `sequence`). `SubmittedCommand` is what a client puts in
`submit-commands` (`type`, `data`, optional `sequence`).

An `*Event` name is an event payload. An `*Request` name is a
client-to-server request. Exceptions: `MatchResumeState` (the result of
`resumeMatch()`), `PlayerCommand` / `SubmittedCommand`,
`SubmitCommandsAck`, and `MatchLogEntry`.

| Event                 | Type                                 | Direction       |
| --------------------- | ------------------------------------ | --------------- |
| `submit-commands`     | `SubmitCommandsEvent`                | client → server |
| `submit-commands-ack` | `SubmitCommandsAck`                  | server → client |
| `player-command`      | `PlayerCommand`                      | client → server |
| `commands-batch`      | `CommandsBatchEvent`                 | server → client |
| `state-hash`          | `StateHashEvent`                     | client → server |
| `hash-comparison`     | `HashComparisonEvent`                | server → client |
| `match-found`         | `MatchFoundEvent`                    | server → client |
| `countdown`           | `CountdownEvent`                     | server → client |
| `game-start`          | `GameStartEvent`                     | server → client |
| `tick-sync`           | `TickSyncEvent`                      | server → client |
| `player-disconnected` | `PlayerDisconnectedEvent`            | server → client |
| `player-reconnected`  | `PlayerReconnectedEvent`             | server → client |
| `player-ready`        | `PlayerReadyEvent`                   | server → client |
| `player-absent`       | `PlayerAbsentEvent`                  | server → client |
| `reconnect-state`     | `ReconnectStateEvent`                | server → client |
| `reconnect-status`    | `ReconnectStatusEvent`               | server → client |
| `match-end`           | `MatchEndEvent`                      | server → client |
| `match-error`         | `MatchErrorEvent`                    | server → client |
| `game-paused`         | `GamePausedEvent`                    | server → client |
| `game-resumed`        | `GameResumedEvent`                   | server → client |
| `queue-status`        | `QueueStatusEvent`                   | server → client |
| `server-shutdown`     | `ServerShutdownEvent`                | server → client |
| `session-token`       | `SessionTokenEvent`                  | server → client |
| `session-superseded`  | `SessionSupersededEvent`             | server → client |
| `match-log`           | `MatchLogRequest`                    | client → server |
| `match-log-cancel`    | `MatchLogCancelRequest`              | client → server |
| `match-log-chunk`     | `MatchLogChunkEvent`                 | server → client |
| `match-log-error`     | `MatchLogErrorEvent`                 | server → client |
| `match-resume-state`  | `MatchResumeState`                   | server → client |
| `match-resume-error`  | `{ reason: MatchResumeErrorReason }` | server → client |
| `room-created`        | `RoomCreatedEvent`                   | server → client |
| `room-recovered`      | `RoomRecoveredEvent`                 | server → client |
| `room-error`          | `RoomErrorEvent`                     | server → client |
| `room-expired`        | `RoomExpiredEvent`                   | server → client |
| `room-cancelled`      | `RoomCancelledEvent`                 | server → client |

`room-create.matchConfig` uses `ServerRoomMatchConfig`. `MatchState` is
the match lifecycle union on `MatchResumeState.state`.

## Not yet in protocol

These socket names are still untyped here.

Server → client: `command-ack`, `command-rejected`, `error`,
`queue-error`, `queue-left`, `match-waiting-for-players`,
`player-timeout`, `player-lagging`.

Client → server requests that are not in the table: `queue-join`,
`queue-leave`, `room-create`, `room-join`, `room-cancel`, `room-recover`,
`client-ready`, `pause-game`, `resume-game`, `match-resume`,
`match-snapshot-request`.

`player-command`, `submit-commands`, `state-hash`, `match-log`, and
`match-log-cancel` are already in the table.
