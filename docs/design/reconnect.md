# Reconnect via snapshots (engine 0.3)

Status: design approved 2026-10-14; implementation in Tasks 7–12
(see [runtime-api.md § Task map](./runtime-api.md#task-map)).

Related: [server-sim.md](./server-sim.md), [runtime-api.md](./runtime-api.md).

## 1. Goal

Reload or close the page, come back, and the match is fully restored, both
online and in local (bot) matches.

## 2. What exists today

- `reconnect-match` takes `playerId` from the request body
  (`phalanx-server/src/Phalanx.ts:684–688`) and calls
  `gameRoom.handleReconnect`. The same pattern is used by `queue-join`
  (`:441`), `room-create` (`:458`), `room-join` (`:468`) and
  `room-recover` (`:525`). This violates AGENTS.md §6 ("Server never trusts
  client-supplied identity"). Task 9 closes that hole for `match-resume`
  always, and for `reconnect-match` plus in-match `room-recover` when
  `reconnect.requireSessionToken` is set. `queue-join`, `room-create`,
  `room-join`, and waiting-room `room-recover` stay on the body id
  until Task 9b.
- When `session` is set, the HMAC token is issued at `match-found`,
  bound to that `matchId` and `playerId`. A drop during the countdown
  resumes with `match-resume`. A match declined or cancelled before
  start tombstones that `matchId`, so the token is rejected. See §4.
- `reconnectGracePeriodMs` only applies in `waiting-for-ready`. During
  `playing` a disconnected player never loses.
- `commandHistoryTicks` defaults to 200 ticks
  (`phalanx-server/src/config/defaults.ts:49`), which is too short to rebuild
  a match from tick 0.

## 3. Relay changes (opt-in, Task 8)

- `commandHistoryTicks: 'full'`: keep the whole match log, storing only
  non-empty ticks (≈ 70–110 KB per 15-minute match). The numeric default
  stays 200 and still stores empty ticks inside that window.
- `match-log { matchId, fromTick, maxTicks?, requestId? }` → a series of
  `match-log-chunk { matchId, fromTick, toTick, entries, done, requestId? }`.
  `toTick` is inclusive. Each chunk covers at most 2000 ticks of the
  requested range `[fromTick, min(currentTick - 1, fromTick + maxTicks - 1)]`
  (when `maxTicks` is omitted, the end is `currentTick - 1`). `entries`
  lists only non-empty ticks, in ascending order, and those commands are
  the same objects that were broadcast in `commands-batch`. The next chunk
  is sent on `setImmediate`. An empty range is one chunk with
  `entries: []`, `toTick = fromTick - 1`, `done: true`.
  One socket has one active stream: a new `match-log` or
  `match-log-cancel { requestId? }` bumps a per-socket generation and the
  previous chain stops. `requestId`, when the client sent one, is echoed
  so a reader can ignore chunks from the stream it replaced. A cancel
  whose `requestId` is not the active one is ignored.
- Refusals are `match-log-error { matchId, reason }` with `reason` of
  `not-member` (socket is not in that match), `not-found`, `invalid`
  (`fromTick` / `maxTicks` not an integer in range), or `truncated`
  (numeric history no longer contains `fromTick`). A partial log is never
  sent in place of `truncated`.
- `reconnect-state.recentCommands` is unchanged. With `'full'`, the window
  is still the numeric default (200 ticks) and empty ticks in that window
  are included as `{ tick, commands: [] }`. The client reads the rest
  through `match-log`.
- `buildId` (string, length 1–128) may be sent on `queue-join`,
  `room-create`, and `room-join`. Anything else is ignored.
  `GameRoom.getBuildId()` is the first non-empty id in `teams.flat()`
  order. With `requireBuildId: true` (default false), a missing or
  differing id ends the match before `match-found`: every player gets
  `match-error { matchId, reason: 'build-mismatch' }`, `stop(true)` runs,
  and `match-ended` / `'build-mismatch'` removes the match. `match-end` is
  not sent. Task 9 compares `getBuildId()` again on resume.
- `Phalanx.shutdown(reason)` emits `server-shutdown { reason, matchIds }`
  to every active room (`matchIds` is the same list for all of them),
  waits `shutdownGraceMs` (`0` still yields one `setImmediate`), then
  `stop()`. Matches end as they do today (`match-end: 'stopped'`), which
  is "no result". A second call returns the same promise.
  `handleSignals: true` (default false) registers
  `process.once('SIGTERM')` → `shutdown('sigterm')` and `stop()` removes
  it. The engine does not call `process.exit`. Redis is not part of 0.3.
- **Match archive (Task 8.1).** `PhalanxConfig.onMatchArchived?: (rec: MatchArchive) => void | Promise<void>`.
  After a match that reached `startGame()` ends, the relay calls the hook
  once with the full stored command log plus seed, `buildId` (omitted when
  absent), teams, `endReason`, and `winnerTeamId` only when `endMatch`
  resolved one. The engine does not write a file, object storage, or a
  database. Omit the hook and the room drops the log at match end with
  nothing built. The hook is not called before start (`build-mismatch`,
  `players-not-connected`, `ready-timeout`, or `stop` / `shutdown` during
  countdown or waiting-for-ready). `shutdown` still ends those matches as
  `stopped` when they had started; it waits for hooks up to
  `shutdownGraceMs` **after** `stop()` (a second grace; the archives do
  not exist until `stop()` runs). With grace 0 or unset, shutdown does
  not await async hooks. `log` entries are the stored
  `PlayerCommand[]` arrays, not copies. A `match-log` stream still in
  flight when the history is released ends with
  `match-log-error { reason: 'not-found' }`.

## 4. Session token (Task 9)

Implemented on the relay, opt-in. Omit `session` and nothing is issued:
`match-resume` answers `match-resume-error { reason: 'invalid' }`, and
`reconnect-match` / `room-recover` stay as they are.

- Config `session: { secret, ttlMs? }`. `secret` is a string of at least
  32 characters. `ttlMs` defaults to 60 minutes (`DEFAULT_SESSION_TTL_MS`),
  longer than a DS match. `reconnect: { requireSessionToken? }` defaults
  to false and does not replace the flat `reconnectGracePeriodMs`.
- Token format:
  `base64url(JSON {matchId, playerId, slot, exp}) + '.' +
base64url(HMAC-SHA256(secret, payloadPart))`.
  The MAC is over the base64url payload string, not a re-encoded JSON
  object. The token is **signed, not encrypted**: anyone who has the
  string can read `matchId`, `playerId`, `slot`, and `exp`. Do not log
  the token or `session.secret`, including the client's `sessionToken`
  payload. `exp` is epoch milliseconds. `nowMs >= exp` is `'expired'`
  (the equal boundary included). Anything malformed is `'invalid'` and
  does not throw. The client treats the string as opaque.
- `slot` is the player's index in `teams.flat()`: team 0 first, and
  within a team the queue order. That is the `match-found` order.
  Task 12 uses the same index.
- The token is issued at `match-found`. Each connected socket gets
  `session-token { token, matchId, slot }` immediately after its
  personal `match-found`, including a retroactive `match-found` while
  `waiting-for-players`. `matchId` and `slot` ride along because the
  client does not parse the token. Connected sockets receive a fresh
  token again at `game-start` (both countdown paths).
  `handleReconnect` sends one after `reconnect-state` with no
  `gameStartEmitted` gate, so a rebind during countdown still gets a
  token. The `reconnect-state` payload is unchanged. `GameRoom` does
  not see the secret; `Phalanx` installs the issuer on
  `match-created`, before `start()`.
- The token is bound to `matchId` and `playerId`. `match-resume`
  looks up that match only, so a token from match A never joins
  match B.
- `match-resume { token, buildId?, haveTick }` →
  `match-resume-state { matchId, slot, currentTick, state, absentDeadline? }`.
  `snapshot?` is Task 11 and is not sent. Check order:
  1. `verify` → `'invalid'` or `'expired'`;
  2. no such match → `'match-ended'` if a tombstone is still fresh,
     otherwise `'invalid'`;
  3. `getBuildId()` is known, `buildId` was sent, and they differ →
     `'build-mismatch'`. A known build with `buildId` omitted is
     allowed unless the match was created with `requireBuildId`, in
     which case the answer is also `'build-mismatch'`;
  4. `playerId` from the token (a body `playerId` is ignored) →
     `handleReconnect`. `false` → `'invalid'`.
     `haveTick` must be an integer `>= -1`. The server checks it and does
     not catch the client up; the client reads `match-log` from
     `haveTick + 1`. Success rebinds the socket's player id, then emits
     `match-resume-state` after `reconnect-state`. The socket this
     player was bound to before is removed from the room and loses
     `socket.data.matchId` / `playerId`. `player-command` and
     `submit-commands` are accepted only from
     `GameRoom.isParticipantSocket`.
- `absentDeadline` is the soonest `deadlineMs` from `GameRoom.getAbsences()`
  among **other** players (the returning player's timer is already
  stopped by `handleReconnect`). Same millisecond-until-expiry meaning
  as Task 10. The field is omitted when nobody else is absent.
- An ended match is remembered for 10 minutes (`matchId → endedAt`) so
  resume can answer `'match-ended'` rather than `'invalid'`. A timer
  drops stale rows. Individual tokens are not revoked. The
  `match-ended` listener records that tombstone for every ending,
  including before start (`ready-timeout`, `players-not-connected`,
  and `stop` during countdown), and in the same listener archives a
  started match via `takeArchive`.
- `requireSessionToken: true` rejects `reconnect-match` with
  `reconnect-status { success: false, reason: 'session-token-required' }`
  and rejects `room-recover` into a match already in progress with
  `room-error`. `message` stays `'session-token-required'` and `reason`
  is the same typed value.
  Waiting-room `room-recover` is unchanged. `false` is the previous
  behaviour. `true` without `session.secret` throws from
  `validateConfig` at startup.
- The client stores `{ token, matchId, slot, buildId }` under
  `phalanx.session.<gameId>` in `localStorage` (not `sessionStorage`,
  which iOS drops when the tab is killed). No `gameId` means the store
  is not created and the token is not saved. `match-end` clears it.
  A later `session-token` overwrites the same key, so the next match
  replaces the previous token.
  `PhalanxClient.resumeMatch(token, haveTick)` sends `match-resume`
  (with `buildId` when the client has one) and rejects
  `MatchResumeRejected`. A rejection of `invalid`, `expired`,
  `match-ended`, or `build-mismatch` clears the store. `timeout` keeps
  it. `sessionToken` fires with `{ token }`; do not log that token.
  `autoReconnect` loads the store and, when the token is for the
  current match, calls `resumeMatch(token, lastTick)` before
  `reconnectToMatch`. A terminal refusal drops the token and then tries
  the legacy rebind. Giving up clears the store and emits
  `reconnectFailed`.
- In the runtime, the token is the transport's concern:
  `ServerPeerTransport.join()` (Task 12) performs `match-resume` and returns
  a `TransportJoin` with `catchUp`. `MatchRunner.join(def, transport)` then
  restores and fast-forwards.

## 5. Absence while `playing` (Task 10)

Implemented on the relay, opt-in. No pause: the absent player's army keeps
acting from the command log, and the economy keeps running. Expiry does not
insert or remove commands. `setController` replacement is Task 11, through
an internal `AbsencePolicy` seam that is not exported.

- Config `absence: { windowMs, matchBudgetMs }`. Omit it for today's
  behaviour (no timer, no `player-absent`, existing `match-end` reasons
  unchanged). `DEFAULT_ABSENCE` is `{ windowMs: 120000, matchBudgetMs: 180000 }`.
  Both values are integers greater than 0. The window may exceed the
  budget; the deadline is `min(windowMs, budgetLeft)`.
- The timer starts only when a player becomes disconnected during
  `playing` (socket drop or `disconnectTicks`). A second signal does not
  restart it. A disconnect while `paused` does not start a timer.
  `resume()` starts one for each player who is still disconnected, cut by
  the remaining budget. A timer that already started keeps running through
  a pause. Nothing starts after
  `finished`. `stop()` and every `match-end` clear the timers.
- Budget is per player. On return, elapsed time is subtracted, not below 0.
  A remaining budget of 0 expires with `setTimeout(…, 0)`, not inside
  `handleDisconnect`.
- Room event `player-absent { playerId, deadlineMs, budgetLeftMs }`. Both
  numbers are milliseconds left at send time. The client counts down from
  receipt. `player-disconnected` and `player-timeout` payloads stay as
  they are (`gracePeriodMs` included).
- Return is `handleReconnect` (`reconnect-match`, `room-recover`, and
  later `match-resume`). There is no separate returned event;
  `player-reconnected` is enough. With `absence` on, the first message
  from the still-bound socket after a `disconnectTicks` timeout is also a
  return, including while `paused` when a timer is already running. A
  disconnect during `paused` starts no timer until `resume()`. With
  `absence` off,
  that message does not set `connected` back to true.
- On expiry, if every human is absent: `endMatch({ reason: 'abandoned' })`
  with no winner. Otherwise
  `endMatch({ reason: 'disconnect', loserIds: [playerId] })`.
  `winnerTeamId` is included when the caller passed a real team, or when
  `loserIds` leaves exactly one team that contains no loser (omitted in
  FFA when more than one team remains). An unknown `winnerTeamId` returns
  false, logs a warning, and leaves the match `playing`. Event order is
  `match-end`, then `match-ended`.
- `tickMode: 'event'` does not run `checkPlayerTimeouts`, so only a socket
  drop starts the timer.
- `GameRoom.getAbsences()` returns the current rows with the same
  millisecond semantics, for Task 9's `absentDeadline`.
- Games finish a match with `ctx.endMatch` on the `player-command` hook
  (`{ matchId, endMatch }`). A hook that ends the match does not log or
  broadcast that command. `ctx.endMatch` returns false when the match is
  already finished or when `winnerTeamId` is not a team in the match.

## 6. Snapshots

- **Server mode:** the server takes a **fresh snapshot on request**
  (`MatchRunner.snapshot()` inside `SimHost`) and sends it with the few
  in-flight ticks. Expected return time ≈ 1–2 s plus network. A periodic
  snapshot every 1000 ticks (`DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS`) exists
  only for persistence across restarts later.
- **Client mode:** a local snapshot every 300 ticks
  (`DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS`) into a `MatchStore`.
  `MemoryMatchStore` and `IndexedDbMatchStore` both live in
  `@phalanx-engine/runtime` (Task 7). The IndexedDB store touches
  `globalThis.indexedDB` only when a method runs, so the package stays free
  of the DOM lib. Schema v2 stores a small `meta` row, one command chunk
  per append, and one snapshot row per retained tick (`DB_VERSION` 2).
  Opening it deletes the v1 `matches` store. Pre-0.3.0 local matches are
  dropped; later versions must migrate. The tick seals the world body
  (buffer handed off without a second copy) plus that tick's bot section
  and input checkpoint.
  `encodeSnapshot` / digest and the store write run later (`setImmediate`
  in Node, `requestIdleCallback` in browsers, otherwise `MessageChannel`
  or `setTimeout(0)`). A hash tick that is also a snapshot tick serializes
  the world once. Snapshot failures are reported separately from the
  header and the command tail.
- Why 300 and not 1000 on the client: ×10 catch-up is not reachable on
  mid-range phones.
  - ×10 needs ≤ 10 ms/tick, but phones take 20–35 ms at the 240-body peak,
    so the real speed is ×3–×6.
  - Closing a gap of G ticks at speed s takes G / (s − 1) live ticks.
- Snapshot size for 240 bodies + 200 projectiles + GAS ≈ 100–115 KB raw,
  35–50 KB deflated. Deserializing takes 10–20 ms on a phone.
- A snapshot contains the engine header, the game body (`GameState.save()`)
  and, outside the digest, the writer's hosted bot state and its input
  checkpoint (commands submitted but not yet delivered, plus per-slot
  sequence counters). See
  [runtime-api.md § Snapshot layout](./runtime-api.md#snapshot-layout).
  A client restoring a server snapshot ignores both extra sections: server
  bot commands arrive later in the command stream. A local resume applies
  them. With input delay 2, a snapshot after tick T still owes commands
  for T+1 and T+2; the checkpoint is what keeps them.

## 7. Catch-up

- Runs on the main thread in chunks of ~80 ms per frame
  (`fastForward({ budgetMs: 80, throughTick })`), with rendering off and a
  progress UI (`onCatchUp`). `throughTick` is inclusive. For a server
  catch-up it is `TransportCatchUp.currentTick - 1` (`GameRoom.currentTick`
  between ticks is the next tick to run). Empty ticks in the gap still
  execute.
- Live batches that arrive during catch-up are buffered. The runner goes
  live at a lag of ≤ 2 ticks.
- Input opens 1 s after going live.
- After loading a snapshot the runner does a round-trip byte check
  (`restore(save(x))` re-saves to identical bytes), then the normal digest
  comparison continues.

## 8. Resync after desync (server mode)

When the server reports `desync` for this client, the runner calls
`transport.requestResync()`, restores the returned snapshot into a fresh
world, fast-forwards the following log and goes live again. The match is
not ended.

## 9. Local bot match

- Auto-pause on `visibilitychange: hidden` is `LocalTransport`'s
  `pauseWhenHidden` (default true, Task 7). A host with no `document`
  ignores it. The pause applies only after the transport has started, so
  a hide during resume catch-up does not skip systems. Becoming visible
  does not resume. The pause goes through the runner-owned provider, so
  it never drops ticks.
- Resume with `MatchRunner.resumeLocal` from the latest stored snapshot
  plus the logged ticks after it, including empty ticks via the stored
  cursor. A restore failure tries the previous snapshot on a new runner
  and deletes the rejected one after a successful catch-up
  (`resumeReport`, `onSnapshotFallback`, optional
  `MatchStore.deleteSnapshot`). `deleteSnapshot` refuses to remove the
  only remaining snapshot once a command at or before a snapshot has been
  dropped, so a tick-0 replay cannot silently drop that command. When
  every snapshot fails it throws
  `MatchResumeError` and leaves the store unchanged. With no snapshot the
  whole log is replayed from tick 0. A snapshot that is already a finished
  match stays ended and does not catch up. The snapshot's controller modes
  and `systemSeq` come
  back with the bot section and the input checkpoint. A fresh match that
  reuses a stored id replaces that record; resume does not.
- The snapshot's input checkpoint is re-submitted when the log has no tail.
  When the log continues through tick L, the checkpoint is discarded and
  hosted bot policies are advanced during catch-up: `decide` runs after
  each replayed tick, and a produced command is submitted only if its
  target tick is past L. Otherwise the next live decision uses the policy
  state from the snapshot tick and diverges from an uninterrupted match.
  Finished replays and clients watching server bots do not run policies.
