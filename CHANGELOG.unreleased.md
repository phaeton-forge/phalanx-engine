# Unreleased (engine 0.3.0)

Entries collected per package until the synchronized 0.3.0 release
(Task 13 turns this file into `CHANGELOG.md`).

## @phalanx-engine/game

- `./advanced` no longer exports `rebuildBroadphaseFromTransforms`.
- New subpath `./server`: `createServerSim`, `ServerSimConfig`,
  `GameModuleSpec`, re-exported from `@phalanx-engine/runtime/server`.
  ```ts
  import { createServerSim } from '@phalanx-engine/game/server';
  new Phalanx({
    sim: createServerSim({ games: [{ module: './myGame.js' }] }),
  });
  ```
- Transport port types moved from the root to `./advanced`:
  `CommandEnvelope`, `Transport`, `TransportKind`, `TransportJoin`,
  `TransportCatchUp`, and `TransportCommand` (previously `WireCommand`).
  The root still exports `LocalTransport`, `LocalTransportOptions` and
  `PersistenceFlushReason`.
- Renamed from `@phalanx-engine/engine` (still `private`, version `0.3.0`,
  not version-bumped). One package, five subpaths. Fixed-point math is
  only on `/math`. The root does not re-export math, physics, abilities
  or advanced.

  | Old import                                                                  | New import                       |
  | --------------------------------------------------------------------------- | -------------------------------- |
  | runtime and the explicit ecs list                                           | `@phalanx-engine/game`           |
  | math (`FP`, vectors, quaternions, `DeterministicRandom`, `FixedPoint`)      | `@phalanx-engine/game/math`      |
  | physics                                                                     | `@phalanx-engine/game/physics`   |
  | abilities                                                                   | `@phalanx-engine/game/abilities` |
  | advanced (`StateHelpers`, `spawnWithId`, `WorldScope`, and the ecs helpers) | `@phalanx-engine/game/advanced`  |

## @phalanx-engine/runtime

- `ENGINE_SNAPSHOT_FORMAT` is 3. World bytes are roster (when any
  non-pooled entity exists), pools, SoA stores, entity ids, RNG, one
  `modules` container, then game singletons. The container is written
  even when no section is registered. Inside it, each registered section
  is `section(key, version, body)`, sorted by UTF-16 code units.
  Format 2 is rejected with
  `unsupported engine snapshot format 2; expected 3`. There is no
  migration. Unknown, missing, unordered and wrong-version module
  sections throw
  `restore: unknown save section '<key>' (registered: <keys>)`,
  `restore: save section '<key>' is missing from the snapshot`,
  `restore: save sections out of order`, and
  `restore: save section '<key>' has version N, expected M`.
  A `modules` container whose version is not 1 throws
  `restore: save section 'modules' has version N, expected 1`.
  Saving a world whose `context.physics` is set without save section
  `physics.broadphase` throws
  `save: physics is assigned but save section 'physics.broadphase' is not registered; call PhysicsWorld.attach(world)`.
  Dependencies are `@phalanx-engine/ecs`, `@phalanx-engine/math` and
  `@phalanx-engine/protocol` (no peer dependencies).
- `StateWriter`, `StateReader`, `BinaryStateWriter` and
  `BinaryStateReader` are re-exported from `@phalanx-engine/ecs`.
- `./advanced` no longer exports `rebuildBroadphaseFromTransforms`.
  `StateHelpers` no longer has `writeBroadphase`, `readBroadphase`,
  `rebuildBroadphaseFromTransforms`, `writeAbilities` or `readAbilities`.
  `StateHelpers` gains `writeModuleSections` and `readModuleSections`
  for a custom `GameState` that must write the `modules` container.
- New subpath `./server`: `createServerSim`, `ServerSimConfig`,
  `GameModuleSpec`. The server simulation that used to live in
  `phalanx-server` runs behind a `ServerSimHook`.
  ```ts
  new Phalanx({
    sim: createServerSim({ games: [{ module: './myGame.js' }] }),
  });
  ```
- `WireCommand` is `TransportCommand` (same fields). `TransportCommand`,
  `CommandEnvelope`, `Transport`, `TransportKind`, `TransportJoin` and
  `TransportCatchUp` moved from the root to `./advanced`. The root keeps
  `LocalTransport`, `LocalTransportOptions` and `PersistenceFlushReason`.
  `MatchRunner` and `LocalTransport` public signatures reference those
  `./advanced` types (`Transport`, `TransportKind`, `TransportCommand`,
  `CommandEnvelope`). `DEFAULT_INPUT_DELAY_TICKS` is defined in the
  protocol package and re-exported.
- `SYSTEM_PLAYER_ID`, `BOT_PLAYER_ID_PREFIX`, `botPlayerId`, and
  `isBotPlayerId` are defined in `@phalanx-engine/protocol` and
  re-exported. `BotHostSide`, `HumanSlotConfig`, `BotSlotConfig`, and
  `SlotConfig` are defined there and re-exported from `MatchConfig`.
  Names on this package are unchanged. `SimMode` and `MatchConfigBase`
  stay here.
- A `setController` command stamped into a relay `commands-batch` (player id
  `system`) is applied on every peer. The same command already applied
  locally is skipped by envelope `q`, so a server and a client do not
  double-apply it.
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
- Copilot follow-up (Task 6): an already-started `restore` flushes the
  checkpoint after the transport seek. Catch-up drops buffered batches
  inside the replayed range and runs the rest in order. Pause and resume
  require transport support. Command batches use a null-prototype player
  map. `WorldScope` saves the active scope across nested `A → B → A`
  runs. A multi-tick timer callback rechecks pause between ticks. The
  input-checkpoint codec round-trips finite JSON numbers and restores
  `__proto__` as an own data property. `restore` keeps a paused transport
  and the rebuilt world in agreement, and resets the match RNG to
  `config.seed` before `createWorld`. `toReplay()` throws when the log
  is incomplete. Catch-up raises each local human seq to the delivered
  `q + 1`. Outcome and digest publish after the tick and the bot
  checkpoint. A delivered `(playerId, q)` leaves every pending bucket.
- World and components (Task 6.5a): `defineComponent`, `world.save` /
  `world.restore`, `world.spawn` / `world.despawn` / `world.each`.
  `defineGame.state` is optional; the default state is those modules.
  Section bytes are unchanged. `configHash` appends each component's name
  and its field names and types, in registration order, when the list is
  non-empty. Restore stores that schema outside the snapshot digest and
  rejects a field change with
  `component 'Unit' schema changed: expected x:i32,hp:u32, got hp:u32,x:i32`.
  `world.restore` returns checked-out pooled entities, removes entities
  missing from the roster, and attaches components from the SoA sections.
  An unknown field type is rejected by `defineComponent` and the error
  lists `i32`, `u32`, `u8`, `i64`, `f32`, `f64`. `world.restore` skips a
  roster id that already exists. `StateHelpers`, `spawnWithId`,
  `rebuildBroadphaseFromTransforms` (formerly `rebuildPhysics`) and
  `WorldScope` moved to `@phalanx-engine/runtime/advanced` with no aliases
  on the root. A manual `LocalTransport.step()` does not rethrow after
  `fail()` / `onError`; `fastForward`, replay, and catch-up still do.
  `defineComponent` rejects `f32` / `f64` fields and the name `SoASchema`.
  A failed `world.spawn` drops the rows it already inserted.
  `registerComponent` publishes the type for `queryEntities`. Restore
  notifies the entity manager when a kept entity gains or loses a
  component, and runs `onDestroy` when a component is dropped.

- Task 6.5b: the game API is `defineComponent` + `defineCommands` +
  `defineGame` + `runLocalMatch`. Migration (no aliases):
  `createWorld` → `onStart`, `applyCommand` → `onCommand`,
  `outcome` → `checkOutcome`, `GameState` → `SaveHandler` (advanced),
  `state.bind` → `save: { handler }` (advanced),
  `LocalTransport.manual` → `LocalTransport.stepped`,
  `simMode` and the runner `side` option → one `side` on the match config
  (`runsOn` stays independent; `side` is omitted from `configHash`),
  `MatchRunner.fromReplay` → `ReplayPlayer.from`. `defineCommands` generates
  decode/encode (never throws on bad input; `i64` is a decimal string) and
  the command schema is part of `configHash`. `onCommand` is a function or
  an exhaustive handler map. `runLocalMatch` expands short slots.
  `ReplayPlayer` exposes `play`, `fastForward`, `digest`, `tick` and
  `onTick`. `setController(slot, mode, { fromTick?, policy? })` logs a
  system command (player id `system`) applied at the start of `fromTick`,
  before game commands, on live play, restore, fast-forward and replay.
  `runsOn` is taken from the bot slot, or is `server` when the runner has a
  server peer and `local` otherwise; a peer that does not host it rejects
  with `not authoritative`. The input checkpoint stores the next system `q` outside the digest, so
  a new runner does not reuse a `q` from commands applied before the snapshot.
  The bot section also stores every slot's controller mode, outside the
  digest, and every peer restores it, so a client keeps a human-to-bot
  handover. A hosted bot is reused only when policy, level, and `runsOn`
  match the saved record. `ReplayPlayer.play` and `fastForward` apply only
  entries in `(currentTick, throughTick]`. Player id `system` is reserved.
  Factory GAS `pendingAdd` is captured in `initComponent`, before a
  snapshot replaces it. `start` throws if a slot
  has `runsOn: 'server'` and the match has no server peer.
  `inputDelayTicks` defaults to 2; `gameId` and `simVersion` are filled
  from the definition. `ENGINE_SNAPSHOT_FORMAT` is 2 (format 1 is rejected).
  Initial GAS `pendingAdd` effects are reseeded by `onEnable`; restore
  passes `'restore'` and does not reseed. New package
  `@phalanx-engine/game` (private, not version-bumped) re-exports runtime
  and the explicit ecs list from the root. Math, physics, abilities and
  advanced are subpath-only. `CommandSchema` and `SaveHandler` are
  `@phalanx-engine/game/advanced`.
- Local persistence (Task 7): `MatchStore`, `MemoryMatchStore` and
  `IndexedDbMatchStore` in `@phalanx-engine/runtime`. `LocalTransport`
  accepts `store`, `snapshotEveryTicks` (default 300) and `pauseWhenHidden`
  (default true). No store keeps the previous transport. A snapshot tick
  seals the world body, bot section and input checkpoint (including
  `systemSeq` and every slot's controller mode) and does not copy the body
  again. `encodeSnapshot` / digest and the store write run off the tick.
  Writes batch every 5s and on hide / `pagehide`. The last two snapshots
  are kept. `MatchRunner.resumeLocal` restores the newest snapshot and
  fast-forwards empty ticks through the stored cursor. It does not start
  the clock. `resumeLocal` accepts `snapshotEveryTicks`, `pauseWhenHidden`,
  and `RunnerOptions`. A tick that is both a hash tick and a snapshot tick
  saves the world once. Off-tick encode uses `setImmediate`,
  `requestIdleCallback`, `MessageChannel`, or `setTimeout(0)`.
  `onPersistenceError` reports a failed snapshot without dropping the
  header or the command tail; header and command failures reject
  `whenPersisted`. A malformed envelope does not dedup away the player's
  first real command in the same tick. Payload dedup sorts object keys.
  Failed snapshot retries keep the newest two. Catch-up does not save a
  snapshot for a tick already stored. A fresh match that reuses a stored
  id clears that record once before the first header write; resume and a
  retried header write do not. `restore` recomputes the terminal phase and
  rejects a snapshot older than the persisted cursor. A tick is journaled
  before outcome, digest, and tick listeners. Hiding the page pauses only
  a started transport. A corrupt IndexedDB row rejects the read.
  The persistence perf test runs only when `PHALANX_PERF=1`.
  `IndexedDbMatchStore` uses `globalThis.indexedDB`.
- Snapshot performance (Task 7.5): XXH64 is an embedded 623-byte WASM
  module (`initDigest`). A cold hash compiles synchronously.
  `onDigestFallback` fires once when that compilation fails. Periodic
  hashes capture the body on the tick and digest it off the tick;
  `onDigest` may run after `runner.tick` has moved on. A throw from
  hashing, `onDigest`, or `submitHash` fails the match. `restore`
  drops digests that have not been delivered. `flush` / `whenIdle`
  finish those digests. `section` writes its body in place, `str`
  caches UTF-8 for strings of at most 128 characters, and the SoA
  writer uses a per-schema field plan. Snapshot bytes are unchanged.
- IndexedDB store: schema v2 (meta / command chunks / snapshots), O(batch)
  appends, pre-0.3.0 v1 data is dropped; `resumeLocal` falls back to the
  previous snapshot (`resumeReport`, `onSnapshotFallback`,
  `MatchResumeError`), rejected snapshots are deleted
  (`MatchStore.deleteSnapshot?`). Deleting the only remaining snapshot is
  refused once a command at or before a snapshot has been dropped, so
  resume cannot replay a partial log from tick 0.
- `decodeInputCheckpoint` throws `SnapshotRejectedError` when a format-2
  input checkpoint has no trailing `systemSeq` (snapshots written before
  setController / 6.5b). `ENGINE_SNAPSHOT_FORMAT` stays 2.

## @phalanx-engine/ecs

- Exports `StateWriter`, `StateReader`, `SaveSection`, `BinaryStateWriter`
  and `BinaryStateReader` (moved from runtime). `GameWorld.registerSaveSection`
  stores a module section. An empty key throws
  `registerSaveSection: key is empty`. A repeated key throws
  `registerSaveSection: duplicate key '<key>'`. `GameWorld.saveSections`
  returns a copy sorted by UTF-16 code units.
  `SystemContext.physics` is a plain field: assigning it has no side
  effects. Physics save registration is `PhysicsWorld.attach(world)` in
  `@phalanx-engine/physics`. `IPoolableComponent` is exported (names
  82 → 83). `isPoolableComponent` stays internal.

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
- Component lifecycle (Task 6.5a): `onCreate`, `onEnable`, `onDisable`,
  `onDestroy`. Spawn enables after `addEntity`. Despawn disables before
  `removeEntity`. `drain` disposes free entities so `onDestroy` runs.
  `isPoolableComponent` and the public story for `addReturnToPoolHook`
  are internal. `IPoolableComponent` is exported. `registerComponent`, `componentNames`,
  `save`, `restore`, `spawn`, `despawn` and `each` are on `GameWorld`;
  the byte format is installed by importing `@phalanx-engine/runtime`.

## @phalanx-engine/math

- `DeterministicRandom` now lives here (`xoroshiro128plus`). `getState()`
  returns four integer words; `setState` / `fromState` continue that
  sequence. Deprecated `float`, `floatRange`, and `boolean` stay as wrappers.
  No new float APIs.
- `getGenerator` and `setGenerator` are deprecated in favour of `getState`
  / `setState` / `fromState`. The generator methods expose `pure-rand`'s
  `RandomGenerator` on the public math API.

## @phalanx-engine/protocol

- `ServerSimHook` and the types the relay and the sim share:
  `ServerSimInfo`, `ServerSimGame`, `ServerSimMatchSpec`, `ServerSimRoom`,
  `ServerSimMatch`, `ServerSimEvents`, `ServerSimPlayerEvents`,
  `ServerDesyncEvent`, `MatchSnapshot`, `MatchSnapshotRequest`,
  `EndMatchResult`.
  `DEFAULT_INPUT_DELAY_TICKS` is `2`. No engine types and no `node:*`.
- New private package `@phalanx-engine/protocol` (`0.3.0`,
  `phalanx.layer: contracts`, no dependencies). It is the wire contract:
  message types, `SlotConfig` / `ServerRoomMatchConfig`, and
  `SYSTEM_PLAYER_ID` / `BOT_PLAYER_ID_PREFIX` / `botPlayerId` /
  `isBotPlayerId`. Not published and not in `PACKAGE_DIRS`.
- `PlayerCommand` is the server-stamped command. `SubmittedCommand` is
  the `submit-commands` body (`type`, `data`, optional `sequence`).
- `MatchResumeState` is the `match-resume-state` payload.
  `HashComparisonEvent` is the `hash-comparison` payload.
  `MatchState` is the match lifecycle union.

## @phalanx-engine/client

- `MatchLogFailureReason` and `MatchResumeFailureReason` are written as
  string literals. The value set is unchanged. `MatchLogErrorReason` and
  `MatchResumeErrorReason` stay re-exported from the protocol package.
- Wire types now come from `@phalanx-engine/protocol`. Removed the local
  copies. `LogChunk` is `MatchLogChunkEvent`. `TickCommandsHistory` is
  `MatchLogEntry`. The client has one reason name per operation:
  `MatchLogFailureReason` (`MatchLogError.reason`) and
  `MatchResumeFailureReason` (`MatchResumeRejected.reason`).
  `MatchLogErrorReason`, `MatchResumeErrorReason`,
  `MatchLogWireErrorReason`, and `MatchResumeWireErrorReason` are
  removed from the client with no replacement.
  `PlayerCommand.playerId` and `PlayerCommand.tick` are required
  (`sequence` stays optional). `SubmittedCommand` is a new export, and
  `submitCommands` takes `SubmittedCommand[]`. `GameStartEvent` includes optional
  `matchConfig`.
  `MatchResumeState` includes optional `snapshot`. `RoomErrorEvent.reason`
  includes `'sim-unavailable'`. `PlayerDisconnectedEvent` includes
  `matchId`. `SubmitCommandsAck` includes `tick` and optional
  `rejectedCount`. `MatchEndEvent` includes optional `winnerTeamId`.
- client: `resumeMatch()`, `MatchSessionStore`, `gameId` config, `sessionToken` event. A killed tab loads `phalanx.session.<gameId>` from `localStorage`, connects, and resumes with the opaque token. `match-end` clears the record. A terminal `resumeMatch` rejection (`invalid`, `expired`, `match-ended`, `build-mismatch`) also clears it; `timeout` keeps it. A new match's `session-token` overwrites the stored token. `autoReconnect` tries `resumeMatch(token, lastTick)` when the store has this match, then `reconnectToMatch`. With `requireSessionToken: true`, a resume timeout does not call `reconnectToMatch`. Giving up clears the store and emits `reconnectFailed`. `sessionSuperseded` fires when this socket is replaced. Do not log the token.
- `DeterministicRandom` is re-exported from `@phalanx-engine/math` under the
  same name. Instance methods are unchanged.
- Opt-in relay catch-up: `PhalanxClientConfig.buildId` is sent on
  `queue-join` / `room-create` / `room-join` only when set.
  `fetchMatchLog(fromTick)` is an `AsyncIterable` of `MatchLogChunkEvent`
  (`match-log` / `match-log-chunk`). One read per socket; a second call
  aborts the first. `match-log-error` rejects with `MatchLogError`.
  A socket drop rejects with reason `disconnected`, and breaking out
  of the read rejects with `aborted` and sends `match-log-cancel`.
  `serverShutdown` fires for `server-shutdown`.
- client: types `room-error` reason `sim-unavailable`,
  `game-start.matchConfig`, and `match-resume-state.snapshot`. It does
  not yet handle `desync` or `match-snapshot` (Task 12).

## @phalanx-engine/server

- Re-exports the type `ServerSimEvents` from `@phalanx-engine/protocol`.

- Removed `PhalanxConfig.games`, `PhalanxConfig.simHost`, `GameModuleSpec`,
  `SimHostConfig` and the `AnyGameDefinition` re-export. Server simulation
  is `sim: createServerSim(...)` (`ServerSimHook` from the protocol
  package). This package no longer depends on `@phalanx-engine/runtime`
  or `@phalanx-engine/ecs`. `EndMatchResult` is imported from the protocol
  package and re-exported. `ServerSimHook` is re-exported.
  Validation errors that used to say `Invalid simHost.*` now say
  `Invalid sim.*` (`Invalid sim`, `Invalid sim.mode`, `Invalid sim.workers`,
  `Invalid sim.snapshotEveryTicks`, `Invalid sim.maxMatches`,
  `Invalid sim.resourceLimits`). `Invalid games: must be an array.` is
  unchanged. `createServerSim({ games: [] })` throws
  `Invalid games: must be a non-empty array.` On main an empty `games`
  list left the process a relay.
  ```ts
  new Phalanx({
    sim: createServerSim({ games: [{ module: './myGame.js' }] }),
  });
  ```
- Wire types moved to `@phalanx-engine/protocol` and are re-exported.
  `MatchResumeStateEvent` is `MatchResumeState`. `DesyncDetectedEvent`
  is removed. `HashComparisonEvent` is the `hash-comparison` payload in
  the protocol package and is not exported from this package.
  `SlotConfig` is imported from the protocol package.
  `SubmitCommandsEvent.commands` is `SubmittedCommand[]`.
  `SubmittedCommand` and `MatchState` are exported: they are the element
  type of `SubmitCommandsEvent.commands` and the type of `MatchInfo.state`.
- server: opt-in server-sim mode — `games` + `simHost` config,
  per-room `matchConfig {gameId, simMode:'server', slots}`, SimHost in a worker_thread (inProcess for tests), server bots `bot:<slot>` stamped at `S + inputDelayTicks` (the room pauses on `sim-lag` when its lead exceeds `inputDelayTicks - 1`),
  hash arbiter, snapshots, public `Phalanx.endMatch`. A worker OOM or thread crash ends every server match on that worker. `maxMatches` is reserved at room create. After the worker dies, `room-create` returns `room-error` `{ reason: 'sim-unavailable' }`. Only `configKeys` integers from `matchConfig` enter the runner config. Player ids `system` and `bot:<slot>` are rejected on queue and room inputs and on human slots. A batch `system` command is applied only when the runner has a server peer. Private-room `matchConfig` is the only 0.3 server-sim entry. Snapshot requests keep one pending id per player. A player is answered at most once a second; an earlier request is kept and answered when that interval elapses. A worker that dies prints the original error, not `process.exit(0)`. Game modules resolve `export` or `default` only.
- server: public sim surface — server events `sim-digest (matchId, tick, digest)` and `sim-fault (matchId, reason, message)` with `reason` `sim-error` | `sim-crash` | `sim-oom`; socket `desync { playerId, tick }` and `match-snapshot-request` / `match-snapshot { tick, bytes, requestId }`; `simHost.resourceLimits`; `Phalanx.getPort()`; types `GameModuleSpec`, `SimHostConfig`, `ServerRoomMatchConfig<Extra>`. `simHost.workers` is reserved until Task 17 (only `1` is accepted). `bot-commands-late` is `(matchId, tick, playerId)`.
- server: opt-in `onMatchArchived(rec: MatchArchive)` hook — the full
  command log plus seed, `buildId`, teams and end reason is handed to the
  game once per started match; the engine stores nothing; without the hook
  the match log is released at match end; `shutdown()` waits for pending
  archive hooks up to `shutdownGraceMs`. An in-flight `match-log` now ends
  with `match-log-error` `{ reason: 'not-found' }` when the match gets
  archived.
- server: opt-in HMAC session token (`session`), `match-resume` / `match-resume-state` / `match-resume-error`, `reconnect.requireSessionToken` (closes the `reconnect-match` identity hole, and in-match `room-recover`). The token is issued at `match-found` and bound to that `matchId` and `playerId`, so a drop during countdown can resume and a token from another match cannot. `exp` is the issue time plus `ttlMs` and is extended by a fresh token at `game-start` and on rebind. `room-recover` during `waiting-for-players` stays open when `requireSessionToken` is set, so a player who missed `match-found` receives the token. A replaced socket receives `session-superseded`. `playerId` on resume comes from the token. An ended match answers `'match-ended'` for 10 minutes, including pre-start endings (`ready-timeout`, `players-not-connected`, `stop` during countdown). The `match-ended` listener archives a started match and records that tombstone together. The token is signed, not encrypted; do not log it. `requireSessionToken` without `session.secret` throws at startup. A superseded socket leaves the room and cannot submit. In-match `room-error` for that gate sets `reason: 'session-token-required'` and keeps `message`.
- server: opt-in absence timer in `playing`
  (`absence: { windowMs, matchBudgetMs }`, `player-absent`, `match-end`
  gains `winnerTeamId`, `reason: 'disconnect' | 'abandoned'`); public
  `GameRoom.endMatch()`, also via the `player-command` hook context. A
  disconnect during pause starts that player's timer on `resume()`.
- `DeterministicRandom` subclasses the math implementation. `fromBigInt`
  is unchanged. `generateSeed` uses an ESM `node:crypto` import instead of
  `require`.
- Opt-in full match log (`commandHistoryTicks: 'full'`), `match-log` from
  any tick in ≤ 2000-tick chunks. A new request or `match-log-cancel`
  stops the previous stream on that socket (`requestId` is echoed).
  Match `buildId` (`requireBuildId`),
  `Phalanx.shutdown()` + `server-shutdown` (`shutdownGraceMs`,
  `handleSignals`). Defaults keep the 200-tick history and do not check
  builds or install a `SIGTERM` handler.

## @phalanx-engine/abilities

- `createAbilitySystem` registers save section `abilities` (version 1).
  The section is not exported. Its body is the former `gas` payload
  without a `section('gas')` wrapper.

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
- The pool reset stays installed by `createAbilitySystem` and is no longer
  a public export. Attributes, the granted ability set, and
  `initComponent` tags match a fresh spawn after despawn and spawn.
- Fixed-point fields on a restored `providedTarget` are recognized by
  shape (`base` and `precision` bigints), not by `instanceof FixedPoint`,
  then reconstructed as a local `FixedPoint` so arithmetic methods exist.

## abilities-playground

- `@phalanx-engine/*` dependencies are `workspace:*`. Bootstrap calls
  `PhysicsWorld.attach(world)`.

## @phalanx-engine/physics

- `PhysicsWorld.attach(world)` sets `context.physics` and registers
  save section `physics.broadphase` (version 1). A second `attach` of
  the same world is a no-op. A different world throws
  `PhysicsWorld.attach: already attached to another world`.
  Assigning `context.physics` does not register the section.
  `PhysicsSystem.init` and `CollisionSystem.init` register it once
  when `context.world` is set, and throw
  `PhysicsSystem.init: context.world is not set` or
  `CollisionSystem.init: context.world is not set` when it is not.
  The section is not a package export. Names stay 33 types and 19
  values; `attach` is a method on `PhysicsWorld`. Its body is the
  former `broadphase` list without a `section('broadphase')` wrapper.
  Inner keys stay `physics`, `physicsSystem` and `collisionSystem`.

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
