---
name: phalanx-protocol
description: Client-server wire types and player-id constants from @phalanx-engine/protocol. Use when reading or changing socket event payloads, submit-commands, match-log, match-resume, room events, hash-comparison, SlotConfig, ServerRoomMatchConfig, SYSTEM_PLAYER_ID, or botPlayerId.
metadata:
  author: phaeton2040-AI
  version: '0.1'
---

# Phalanx Protocol Skill

`@phalanx-engine/protocol` is the contracts layer. It has no dependencies
and is private at `0.3.0` until the synchronized release. Do not add it to
`PACKAGE_DIRS`.

Client, server, and runtime import message types and
`SYSTEM_PLAYER_ID` / `BOT_PLAYER_ID_PREFIX` / `botPlayerId` /
`isBotPlayerId` from here. Runtime still re-exports those names.
`SimMode` and `MatchConfigBase` stay in the runtime.

`ServerSimHook` is how a relay runs a simulation. `createServerSim` in
`@phalanx-engine/runtime/server` returns one. Related types:
`ServerSimInfo`, `ServerSimGame`, `ServerSimMatchSpec`, `ServerSimRoom`,
`ServerSimMatch`, `ServerSimEvents`, `ServerDesyncEvent`, `MatchSnapshot`,
`MatchSnapshotRequest`, `EndMatchResult`. `DEFAULT_INPUT_DELAY_TICKS` is
`2`. None of these carry engine types.

`PlayerCommand` is the stamped command in batches, the log, and
`player-command`. `SubmittedCommand` is the client body of
`submit-commands` (`type`, `data`, optional `sequence`).

`MatchResumeState` is the `match-resume-state` payload (includes optional
`snapshot`). `HashComparisonEvent` is the `hash-comparison` payload.
`RoomErrorEvent.reason` is `'session-token-required' | 'sim-unavailable'`.
`ReconnectStateEvent` does not include the room's internal `players`
array, which the server still sends.

Event names and payload fields are the wire format. Change them only when
a task says the wire format changes.

`command-ack`, `command-rejected`, `error`, `queue-error`, `queue-left`,
`match-waiting-for-players`, `player-timeout`, `player-lagging`, and the
untyped client→server requests (`queue-join`, `queue-leave`,
`room-create`, `room-join`, `room-cancel`, `room-recover`,
`client-ready`, `pause-game`, `resume-game`, `match-resume`,
`match-snapshot-request`) are not in this package yet. See the README.
