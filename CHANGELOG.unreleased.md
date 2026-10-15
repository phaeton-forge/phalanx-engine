# Unreleased (engine 0.3.0)

Entries collected per package until the synchronized 0.3.0 release
(Task 13 turns this file into `CHANGELOG.md`).

## @phalanx-engine/runtime

- New package `@phalanx-engine/runtime` (0.3.0, `private` until release):
  contracts and skeleton for server-side simulation, snapshots and
  reconnect (Task 1). Adds `defineGame`, `GameDefinition`, `MatchConfigBase`
  / `SlotConfig` / `simMode`, `CommandSchema`, the approved `GameState` /
  `GameStateSpec` / `StateWriter` / `StateReader` contract, the snapshot
  header and version policy types, `StateHelpers`, `BotPolicy`,
  `MatchRunner`, `CommandLog`, `WorldScope`, `Transport` and
  `LocalTransport`. Only `defineGame`, the constants and small helpers are
  implemented; everything else throws `NotImplementedError` naming the task
  that implements it.
- Design docs: `docs/design/server-sim.md`, `docs/design/reconnect.md`,
  `docs/design/runtime-api.md` (including the review of the contracts
  against the engine code).
- `AGENTS.md` §0 and §4.6 amended for opt-in server simulation and bot
  slots. §0.1 now bans `IRandom.float`, `floatRange` and `boolean` in
  simulation code; those methods are `@deprecated`.
- Review follow-up: a snapshot carries an input checkpoint (submitted but
  not yet delivered commands) outside the digest; local resume with a log
  tail advances hosted bot policies instead of leaving them at the snapshot
  tick; `fastForward` takes an inclusive `throughTick` so empty ticks run;
  broadphase restore uses the pre-separation centers (`writeBroadphase` /
  `readBroadphase`), not a rebuild from the saved transforms.
- Decisions: no Redis in 0.3 (a restart ends in-memory matches with no
  result); relay desync ends the match and server-mode desync resyncs the
  client; Sketch Legion gets a practice entry plus matchmaking bot
  auto-fill.
- Canonical state bytes (Task 2): `BinaryStateWriter` / `BinaryStateReader`
  (`list` keeps order, `sortedBy` sorts unique integer keys), `encodeSnapshot`
  / `decodeSnapshot` with the `PHXS` header, xxhash64 `digestBytes`,
  `canonicalConfigBytes` / `configHash`, and `checkSnapshotCompatibility`.
  The digest covers `GameState` bytes only; bot state and the input
  checkpoint are stored outside it. No float methods. `decodeSnapshot`
  throws `SnapshotRejectedError` (with the reader error as `cause`) for a
  truncated buffer or trailing bytes. Non-canonical varints are rejected,
  and a `list` / `sortedBy` count that cannot fit in the remaining bytes
  throws. `migrations[v]` is the step from version `v` to `v + 1`. A
  `simVersion` mismatch still rejects. `StateWriter.str` rejects unpaired
  UTF-16 surrogates (including canonical config keys and values), and
  `StateReader.str` keeps a leading U+FEFF.

## @phalanx-engine/ecs

- Snapshot accessors (Task 3): `getEntityIdCounter` / `setEntityIdCounter`
  (module functions and `GameWorld` delegates), `SoAComponent.currentEntityManager()`,
  and pool `typeKeys` / `ownedIds` / `freeListIds`. Allocation order, the
  constructor reset, and pool acquire/release behavior are unchanged.

## @phalanx-engine/math

- `DeterministicRandom` now lives here (`xoroshiro128plus`). `getState()`
  returns four integer words; `setState` / `fromState` continue that
  sequence. Deprecated `float`, `floatRange`, and `boolean` stay as wrappers.
  No new float APIs.

## @phalanx-engine/client

- `DeterministicRandom` is re-exported from `@phalanx-engine/math` under the
  same name. Instance methods are unchanged.

## @phalanx-engine/server

- `DeterministicRandom` subclasses the math implementation. `fromBigInt`
  is unchanged. `generateSeed` uses an ESM `node:crypto` import instead of
  `require`.

## @phalanx-engine/abilities

- `InstanceIdCounter.set(n)` restores any integer `>= 0`.
  `AbilitySystem.exportRuntimeState` / `importRuntimeState` copy the
  instance-id counter, activation queue, current tick, and resolved
  activations. The cue buffer is not part of that snapshot.

## @phalanx-engine/physics

- `SpatialHashGrid.getCenters`, `PhysicsSystem` / `CollisionSystem` /
  `PhysicsWorld.getBroadphaseCenters`, and `rebuildBroadphase` (clear and
  re-insert from current transforms in ascending entity id; no collision
  resolution). The live physics step still rebuilds only before resolution.
