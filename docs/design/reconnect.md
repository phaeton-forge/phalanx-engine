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
  client-supplied identity"); Task 9 fixes it.
- `reconnectGracePeriodMs` only applies in `waiting-for-ready`. During
  `playing` a disconnected player never loses.
- `commandHistoryTicks` defaults to 200 ticks
  (`phalanx-server/src/config/defaults.ts:49`), which is too short to rebuild
  a match from tick 0.

## 3. Relay changes (opt-in, Task 8)

- `commandHistoryTicks: 'full'`: keep the whole match log, storing only
  non-empty ticks (≈ 70–110 KB per 15-minute match).
- `match-log` request from tick N, answered in chunks of at most 2000 ticks.
- Match `buildId` check: a client with a different build cannot resume.
- On SIGTERM, send `server-shutdown` to all rooms. A Render deploy restarts
  the process and kills in-memory matches, which end with "no result" for
  now (Redis later).

## 4. Session token (Task 9)

- At game start the relay issues an HMAC-SHA256 token
  `{matchId, playerId, slot, exp}`.
- The client stores `{token, matchId, slot, buildId}` in `localStorage` (not
  `sessionStorage`, which iOS drops when the tab is killed).
- `match-resume {token, buildId, haveTick}` →
  `match-resume-state {currentTick, state, absentDeadline, snapshot?}`.
- The server derives `playerId` from the verified token, never from the
  body. This fixes the `reconnect-match` §6 violation.
- In the runtime, the token is the transport's concern:
  `ServerPeerTransport.join()` (Task 12) performs `match-resume` and returns
  a `TransportJoin` with `catchUp`. `MatchRunner.join(def, transport)` then
  restores and fast-forwards.

## 5. Absence while `playing` (Task 10)

- No pause. The absent player's army keeps spawning by formation and the
  economy keeps running.
- Window **120 s** per absence, per-match budget **180 s**. The opponent sees
  a countdown.
- On expiry the server ends the match (`reason: 'disconnect'`) through a new
  public `GameRoom.endMatch`.
- All humans absent → `abandoned`.

## 6. Snapshots

- **Server mode:** the server takes a **fresh snapshot on request**
  (`MatchRunner.snapshot()` inside `SimHost`) and sends it with the few
  in-flight ticks. Expected return time ≈ 1–2 s plus network. A periodic
  snapshot every 1000 ticks (`DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS`) exists
  only for persistence across restarts later.
- **Client mode:** a local snapshot every 300 ticks
  (`DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS`) into a `MatchStore`. The browser
  store (`IndexedDbMatchStore`) lives in `@phalanx-engine/client`, because the
  runtime has no DOM; the runtime owns the `MatchStore` interface and an
  in-memory store (Task 7).
- Why 300 and not 1000 on the client: ×10 catch-up is not reachable on
  mid-range phones.
  - ×10 needs ≤ 10 ms/tick, but phones take 20–35 ms at the 240-body peak,
    so the real speed is ×3–×6.
  - Closing a gap of G ticks at speed s takes G / (s − 1) live ticks.
- Snapshot size for 240 bodies + 200 projectiles + GAS ≈ 100–115 KB raw,
  35–50 KB deflated. Deserializing takes 10–20 ms on a phone.
- A snapshot contains the engine header, the game body (`GameState.save()`)
  and, separately, the state of the bots hosted by the side that took it.
  Bot state is outside the digest (see
  [runtime-api.md § Snapshot layout](./runtime-api.md#snapshot-layout)).
  A server snapshot sent to a client carries the server bots' state, which
  the client ignores.

## 7. Catch-up

- Runs on the main thread in chunks of ~80 ms per frame
  (`fastForward({ budgetMs: 80 })`), with rendering off and a progress UI
  (`onCatchUp`).
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

- Auto-pause on `visibilitychange: hidden` (client package, Task 7). The
  runtime's pause goes through the runner-owned provider, so it never drops
  ticks.
- Resume from the latest stored snapshot plus the logged ticks after it.
