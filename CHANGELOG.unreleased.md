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
- State helpers (Task 4): `StateHelpers` saves and restores SoA rows
  (explicit schema names; `f32` / `f64` fields skipped), the entity id
  counter, `spawnWithId`, pool owned ids and free lists (registration
  order), `DeterministicRandom.getState` (four int32 words via `setState`,
  not `getGenerator`), and broadphase centers (`x`, `z`, and `radius`,
  each with its own precision) through `writeBroadphase` /
  `readBroadphase`. `rebuildPhysics` only rebuilds from current transforms
  and is valid for a collision-free world. Ability helpers are the Task 5
  bullet below. A zero-row SoA section recreates a missing
  empty store (`getOrCreateSoAStore`); a nonempty section with no row still
  throws `readSoAStore: missing entity <id> in <schema>`. A row the
  section omitted throws `readSoAStore: extra entity <id> in <schema>`.
  `readPools` discards prewarmed free entities, constructs owned ids with
  `PoolManager.createForRestore`, and calls `onDespawn` again for free
  entities. `readEntityIds` then restores the counter. Broadphase restore
  writes `lastX` / `lastZ` from the saved centers; games must not read
  those fields in simulation. `CollisionSystem` is discovered under the
  key `collisionSystem`. Physics is an optional peer; math stays a peer.
  The package and its ecs/physics dependency graph emit NodeNext ESM so
  `import('@phalanx-engine/runtime')` loads under native Node. The runtime
  test script imports `dist/index.js` after vitest. The empty-store SoA
  change landed in the same commit as the NodeNext emit. Every
  `@phalanx-engine/*` package test script now imports its own `dist/index.js`
  the same way, including abilities after its NodeNext migration.
- State helpers (Task 5): `writeAbilities` / `readAbilities` persist
  `section('gas', 1)`. The per-world runtime comes from
  `exportRuntimeState` / `importRuntimeState` (instance-id counter,
  activation requests, `currentTick`, resolved activations). The cue
  buffer is omitted. Entities with a GAS component are stored ascending
  by id, with flags so lazy components are recreated. Attribute `base` /
  `current` are `i64` and `dirty` is `u8`. The effect queue and
  `pendingAdd` keep array order. Abilities, tags, ad-hoc tags and grant
  counts keep insertion order. `setByCaller` keys are sorted; values are
  a safe integer, bigint, string, boolean, or FixedPoint, and any other
  type throws. `@phalanx-engine/abilities` is a dependency and a peer.
  Restore order is `spawnWithId`, `readPools`, `readSoAStores`,
  `readAbilities`, `readEntityIds`, `readRandom`, `readBroadphase`.
  Fixed-point payloads in the GAS section store `base` and `precision` as
  `i64`, matching broadphase centers. `readAbilities` parses and validates
  the section before mutating: an unknown ability id or effect def id
  throws with the entity id, and the instance-id counter must be `>=`
  every queued effect instance id (pending adds have none). A failed read
  leaves the world unchanged. Free-list entities are omitted. Pool
  despawn clears queue, pending adds, tags, and grants on the factory
  shell and removes GAS components attached after that shell, so a
  restored bare entity matches one that never snapshotted.
  `readAbilities` refills `queue` and `pendingAdd` by clearing each array
  and pushing entries one at a time. A list of hundreds of thousands of
  effects does not throw, and the destination arrays keep their identity.
- Match runner (Task 6): `MatchRunner` drives one `GameDefinition` from any
  `Transport` through a runner-owned tick provider and `world.start()`.
  `CommandLog` stores raw envelopes, including rejected commands and empty
  ticks. `BotHost` runs the policies for the runner's side, with one
  `DeterministicRandom` per slot mixed from `(config.seed, slot)`.
  `WorldScope` isolates the entity id counter and the SoA entity manager.
  `LocalTransport` is in-memory (timer, or `manual()` + `step`).
  `submit` targets `tick + inputDelayTicks` and does not validate; decode
  and validate run inside the tick in `(slot, seq)` order. Snapshots taken
  after `decide` carry bot state and the input checkpoint outside the
  digest. `restore` round-trips `GameState` and applies those extras only
  for slots this runner hosts or submits. `fastForward` takes an inclusive
  `throughTick`, runs empty ticks, and yields on `budgetMs`. `fromReplay`
  never calls `decide`. `MatchRunner.join` remains Task 12.
- Review follow-up (Task 6): a malformed envelope is logged and rejected
  (`'malformed envelope'`) instead of killing the runner. Throws from
  `decode` and `validate` become rejections. A throw inside a tick calls
  `onError(error, tick)`, sets `status` to `'failed'`, stops the
  transport, and leaves `tick` on the previous completed tick. A bot
  `decide` that throws is logged and that slot submits nothing; the match
  continues, and policy state may already be partial. Outcome is emitted
  once, then `status` is `'ended'` and the transport stops. Live log
  payloads use canonical object-key order so they match a restored
  checkpoint. `LocalTransport` rejects submits more than `maxAheadTicks`
  past `nextTick` (default 8) and waits `tickDuration - accumulator`
  before the next timer. `fromReplay` is driven only by
  `fastForward(replay.log)`; `start()` throws. `RunnerStatus` is a type
  export.

## @phalanx-engine/ecs

- Snapshot accessors (Task 3): `getEntityIdCounter` / `setEntityIdCounter`
  (module functions and `GameWorld` delegates), `SoAComponent.currentEntityManager()`,
  and pool `typeKeys` / `ownedIds` / `freeListIds`. Allocation order, the
  constructor reset, and pool acquire/release behavior are unchanged.
- `setEntityIdCounter` still accepts any integer `>= 0`. The caller must
  pass a value `>=` every live entity id; a lower value is stored and the
  next allocation can collide.
- `SoAComponent.useEntityManager(null)` clears the context, the same as
  `resetContext()`.
- `PoolManager.createForRestore(typeKey)` runs the raw factory with no
  spawn or despawn hooks. `discardPrewarmed` disposes a free, unregistered
  prewarm list. `restore` discards that list before adopting the snapshot.
- `PoolManager.restore(typeKey, entitiesInCreationOrder, freeListIds)`
  replaces that pool's owned set and free list without creating entities.
  The next `spawn` pops the same id the free list would have returned.
- `PoolManager.addReturnToPoolHook` runs after entity and component
  despawn hooks (factory dormant pass, `despawn`, and
  `runDormantHooks`). `readPools` parks a free-list entity through
  `runDormantHooks`.
- Built output is NodeNext ESM: relative specifiers end in `.js`, and
  directory imports (`./pool`, `./debug`) point at `index.js`, so Node can
  load the package without a bundler.
- An entity disposed outside `despawn` / `release` is dropped from the
  pool's owned set and free list, so a snapshot does not keep the dead id.
  `destroy()` only marks the entity. Snapshot reads and the next `acquire`
  keep that instance, its id, and its components.

## @phalanx-engine/math

- `DeterministicRandom` now lives here (`xoroshiro128plus`). `getState()`
  returns four integer words; `setState` / `fromState` continue that
  sequence. Deprecated `float`, `floatRange`, and `boolean` stay as wrappers.
  No new float APIs.
- `getGenerator` and `setGenerator` are deprecated in favour of `getState`
  / `setState` / `fromState`. The generator methods expose `pure-rand`'s
  `RandomGenerator` on the public math API.

## @phalanx-engine/client

- `DeterministicRandom` is re-exported from `@phalanx-engine/math` under the
  same name. Instance methods are unchanged.

## @phalanx-engine/server

- `DeterministicRandom` subclasses the math implementation. `fromBigInt`
  is unchanged. `generateSeed` uses an ESM `node:crypto` import instead of
  `require`.

## @phalanx-engine/abilities

- Built output is NodeNext ESM: relative specifiers end in `.js`, and
  directory imports (`./api`, `./components`, `./runtime`, and the other
  barrels) point at `index.js`. Native Node can import
  `@phalanx-engine/abilities` from `dist` without
  `ERR_UNSUPPORTED_DIR_IMPORT`.
- `InstanceIdCounter.set(n)` restores any integer `>= 0`.
  `AbilitySystem.exportRuntimeState` / `importRuntimeState` copy the
  instance-id counter, activation queue, current tick, and resolved
  activations. The cue buffer is not part of that snapshot.
- **Interface change:** `AbilitySystem` now requires `exportRuntimeState`
  and `importRuntimeState`. External implementations and test mocks of
  `AbilitySystem` must add both methods.
- `importRuntimeState` rejects an `abilityId` that is not in the ability
  registry. `instanceId` must be `>=` every live effect instance id; that
  bound is the caller's responsibility (a lower integer is still stored).
  `readAbilities` enforces the bound before it applies a snapshot.
- **Interface change:** `AbilitySystem` now requires `isAbilityRegistered`
  and `isEffectRegistered`.
- Pooled entities lose transient GAS state on despawn.
  `releasePooledAbilityState` records the factory shell on the first call
  (attribute `base` / `current` / `dirty`, the equipped ability set, and
  ad-hoc tags plus effect grants, including `initComponent` tags). Later
  calls clear the effect queue and `pendingAdd`, copy that shell back, and
  remove `AbilitySystem`, `Attributes`, `ActiveEffects`, and
  `GameplayTags` components attached after that shell. A bare pooled
  entity that gained effects or tags during its life is dormant without
  those components, matching the shell `readPools` rebuilds.
  `createAbilitySystem` registers the hook. Initial `pendingAdd` effects
  are not part of the shell, so `onSpawn` must re-seed those. A respawn
  whose `onSpawn` does not rewrite attributes matches a restored copy,
  because a free-list entity is omitted and restore builds a fresh factory
  instance. The hook also runs on the factory's initial dormant pass.
- Fixed-point fields on a restored `providedTarget` are recognized by
  shape (`base` and `precision` bigints), not by `instanceof FixedPoint`,
  then reconstructed as a local `FixedPoint` so arithmetic methods exist.

## @phalanx-engine/physics

- Built output is NodeNext ESM: relative specifiers end in `.js`, and
  directory imports (`./components`, `./systems`) point at `index.js`.
- `CollisionSystem` is exported from the package entry.
  `restoreBroadphase` writes `lastX` / `lastZ` with `FP.ToFloat` of the
  saved centers. Those fields are presentation caches; simulation must
  not read them.
- `SpatialHashGrid.getCenters`, `PhysicsSystem` / `CollisionSystem` /
  `PhysicsWorld.getBroadphaseCenters`, and `rebuildBroadphase` (clear and
  re-insert from current transforms in ascending entity id; no collision
  resolution). The live physics step still rebuilds only before resolution.
- `BroadphaseCenter` includes the `radius` used for cell coverage.
  `restoreBroadphase(centers)` clears the grid and re-inserts those
  centers in ascending entity id. Snapshot restore must use the saved
  centers: `rebuildBroadphase` reads current transforms and is valid only
  for a collision-free world. After resolution the live grid still holds
  the pre-separation centers. Exported centers copy each value's own
  precision (`FP.FromRaw` would default to 5).
