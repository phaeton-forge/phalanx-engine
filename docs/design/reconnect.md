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
  the process and kills in-memory matches, which end with "no result".
  That is accepted for 0.3 (no players yet). Redis is not part of this
  release.

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
  (`DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS`) into a `MatchStore`.
  `MemoryMatchStore` and `IndexedDbMatchStore` both live in
  `@phalanx-engine/runtime` (Task 7). The IndexedDB store touches
  `globalThis.indexedDB` only when a method runs, so the package stays free
  of the DOM lib. The tick seals the world body (buffer handed off without
  a second copy) plus that tick's bot section and input checkpoint.
  `encodeSnapshot` / digest and the store write run later (`setImmediate`
  in Node, `requestIdleCallback` in browsers).
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
  ignores it. Becoming visible does not resume. The pause goes through the
  runner-owned provider, so it never drops ticks.
- Resume with `MatchRunner.resumeLocal` from the latest stored snapshot
  plus the logged ticks after it, including empty ticks via the stored
  cursor. The snapshot's controller modes and `systemSeq` come back with
  the bot section and the input checkpoint.
- The snapshot's input checkpoint is re-submitted when the log has no tail.
  When the log continues through tick L, the checkpoint is discarded and
  hosted bot policies are advanced during catch-up: `decide` runs after
  each replayed tick, and a produced command is submitted only if its
  target tick is past L. Otherwise the next live decision uses the policy
  state from the snapshot tick and diverges from an uninterrupted match.
  Finished replays and clients watching server bots do not run policies.
