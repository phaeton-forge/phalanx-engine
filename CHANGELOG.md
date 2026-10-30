# Changelog

## 0.3.1 — 2026-10-30

### @phalanx-engine/client

The client forwards the server `player-absent` room event.
`PhalanxClient` emits `playerAbsent` with `PlayerAbsentEvent`
(`playerId`, `deadlineMs`, `budgetLeftMs`). Both durations are
milliseconds remaining at send time, not an epoch. Count down from
receipt. A return is still `playerReconnected`.

## 0.3.0 — 2026-10-24

All nine `@phalanx-engine/*` packages are published together at `0.3.0`.
`@phalanx-engine/protocol`, `@phalanx-engine/runtime`, and
`@phalanx-engine/game` are public. `scripts/bump-package-versions.mjs`
covers every package, and `pnpm version:check` fails when their versions
diverge or any of them is `"private": true`.

### @phalanx-engine/game

Game-facing entry point. One package, seven subpaths. The root re-exports
the runtime match API and the explicit ecs surface. Math, physics,
abilities, and advanced helpers stay on their own subpaths.

| Import                                                          | Subpath                          |
| --------------------------------------------------------------- | -------------------------------- |
| `defineGame`, `MatchRunner`, `saveWorld`, ecs world and systems | `@phalanx-engine/game`           |
| `FP`, vectors, quaternions, `DeterministicRandom`               | `@phalanx-engine/game/math`      |
| `PhysicsWorld` and the physics helpers                          | `@phalanx-engine/game/physics`   |
| ability definitions and `createAbilitySystem`                   | `@phalanx-engine/game/abilities` |
| `StateHelpers`, `spawnWithId`                                   | `@phalanx-engine/game/advanced`  |
| `ServerPeerTransport`                                           | `@phalanx-engine/game/net`       |
| `createServerSim`                                               | `@phalanx-engine/game/server`    |

`@phalanx-engine/client` is an optional peer, required by `./net`.
`TICK_PHASES`, `FRAME_PHASES`, and `AddSystemOptions` are on the root.
Transport port types (`Transport`, `TransportCommand`, `CommandEnvelope`,
and the join and catch-up types) are on `./advanced`. The root still
exports `LocalTransport`.

### @phalanx-engine/runtime

Isomorphic match runtime.

- `defineGame`, `defineCommands`, and `onCommand` describe a game.
  `defineCommands` generates decode and encode. The command schema and
  component fields are part of `configHash`. `GameDefinition.systems` run
  in the `late` tick phase. `frameSystems` run in `render`. A system that
  belongs in another phase is added from `onStart` with `world.addSystem`.
- `MatchRunner` drives one definition from a `Transport`. `join` starts a
  fresh match, or restores a server snapshot (without its bot state or
  input checkpoint) and fast-forwards the log. With `onDesync` and
  `requestResync`, one resync runs at a time. `resumeLocal` restores the
  newest `MatchStore` snapshot and fast-forwards empty ticks through the
  stored cursor. `ReplayPlayer.from` replays a log and does not call bot
  `decide`. `BotHost` emits ordinary commands for bot slots.
  `setController` hands a slot between a human and a bot. That command is
  player id `system` and is applied once on every peer.
- `LocalTransport` is in-memory. `ServerPeerTransport` (`./net`,
  `kind: 'server-peer'`) joins through `PhalanxClient`. It resumes from
  `MatchSessionStore` when the stored session has `matchConfig`; otherwise
  it waits for `game-start`, requires `matchConfig`, and sends
  `client-ready`. `@phalanx-engine/client` is an optional peer.
- `createServerSim` (`./server`) is the `ServerSimHook` passed to
  `new Phalanx({ sim })`.
- `saveWorld` / `restoreWorld` and `spawn` / `despawn` / `each` replace
  the old `GameWorld` methods. World modules are the default save handler.
  `ENGINE_SNAPSHOT_FORMAT` is 3. Format 2 is rejected. There is no
  migration. The digest covers game-state bytes only. `configHash`
  includes component schemas and tick-system names. Frame-system names
  are not hashed.
- `MatchStore`, `MemoryMatchStore`, and `IndexedDbMatchStore`. IndexedDB
  is schema v2. Pre-0.3.0 rows are dropped. `resumeLocal` can fall back
  to the previous snapshot. `TickFrameManager` and `attachDebug` live
  here. A debug snapshot timestamp is wall-clock time and is not
  simulation state.

### @phalanx-engine/protocol

Network contracts with no dependencies (`phalanx.layer: contracts`).

- Wire types shared by the client and the server, including
  `ServerSimHook`, `MatchSnapshot`, `MatchSnapshotRequest`,
  `ServerDesyncEvent`, `SlotConfig`, and `ServerRoomMatchConfig`.
- `SYSTEM_PLAYER_ID` is `'system'`. `botPlayerId(slot)` builds
  `'bot:<slot>'`. `isBotPlayerId` recognises that form.
- `DEFAULT_INPUT_DELAY_TICKS` is 2. No engine types and no `node:*`
  imports.

### @phalanx-engine/ecs

Each world owns its state. There is no process-global event bus, entity
id counter, or SoA context.

- `world.createEntity` allocates the next id and registers the entity.
  `world.createEntityWithId` claims that id. The high-water mark moves
  forward only. `new Entity()` without an id is gone. Pool factories are
  `(id, world)`. A dormant pooled entity stays unregistered until
  `spawn`.
- `defineComponent` has three kinds. SoA fields are `i32`, `u32`, `u8`,
  and `i64`. Those rows are saved, and each field's name and type stay in
  `configHash`. A float field throws. Object components require `save`
  and `load`. `Set` and `Map` values are written in key order. Transient
  components are display state: they are omitted from the save and from
  `configHash`, and a tick read throws.
- `world.addComponent`, `world.getComponent`, and
  `world.removeComponent`. `world.registerComponent(def, { attach, remove })`
  lets a module replace the default add and remove. The world does not
  write a save section for that component and does not drop it on pool
  return.
- `defineService`, `world.provide`, and `context.getService`. Keys
  compare by reference. `context.physics` and `context.abilities` are
  gone.
- `world.query` and `world.queryAny` return rows in ascending entity id.
  A SoA slot is the store row index. An object or transient slot is the
  value.
- `world.addSystem(system, { phase, before?, after? })`. Tick phases are
  `input`, `physics`, `abilities`, `late` (`TICK_PHASES`). Frame phases
  are `interpolation`, `render`, `present` (`FRAME_PHASES`). Systems run
  in registration order inside a phase. `before` and `after` refine that
  order and must name a system in the same phase. `registerSystems`,
  `addModuleSystems`, and `addFrameSystem` are removed. System names are
  unique. Tick names are part of `configHash`. `start()` freezes the
  order.
- `TickFrameManager`, `DebugDataProvider`, and `DebugPanel` moved to
  `@phalanx-engine/runtime`. `GameWorldConfig.tickFrameProvider` is
  required. `start()` subscribes to the provider. It does not start or
  stop it.
- `StateWriter`, `StateReader`, `BinaryStateWriter`, and
  `BinaryStateReader` are exported from ecs. `"sideEffects": false`.

### @phalanx-engine/physics

- `PhysicsWorld.attach(world)` registers `Transform`, `PhysicsBody`, and
  transient `Interpolation`, provides the `Physics` service, adds
  `GravitySystem` then `PhysicsSystem` in the `physics` phase and
  `InterpolationSystem` in the `interpolation` phase, and registers save
  section `physics.broadphase` (version 1). A second `attach` of the same
  world is a no-op. Attaching a different world throws.
- `integrate: false` is collisions-only. The game moves bodies and
  physics separates them. One resolution pass per tick. `subSteps`,
  friction, `maxVelocity`, and `worldBounds` do not apply. The `'push'`
  force is `overlap × pushStrength` and still writes `velocity`, which
  is not integrated into position. `CollisionSystem`,
  `IPhysicsTickProvider`, and `tickProvider` are removed. Physics
  advances on the world tick. `PhysicsSystem.step()` stays for tests.
- `Transform` and `PhysicsBody` are SoA `defineComponent` rows.
  `Interpolation` is transient. Position, rotation, velocity, and the
  interpolation sample are helper functions (`readFpPosition`,
  `writeFpPosition`, `setVelocity`, and the rest). The wrapper component
  classes are gone. Helpers take the entity. `readBroadphase` attaches
  `Interpolation` to every entity that has `Transform` and `PhysicsBody`
  and seeds both samples from the transform.

Peers are `@phalanx-engine/ecs` and `@phalanx-engine/math` at
`workspace:^` (published as `^0.3.0`).

### @phalanx-engine/abilities

- `createAbilitySystem(world, config)` registers `AbilityOwner`,
  `Attributes`, `ActiveEffects`, and `GameplayTags`, provides the
  `Abilities` service, adds the simulation systems in the `abilities`
  phase (pipeline order) and cue presentation in the `present` phase, and
  registers save section `abilities` (version 1).
- One data representation. `AbilityOwnerState` is
  `{ abilities: Set<string> }`. Attributes, effects, and tags live only
  on their own components. `world.addComponent(entity, AbilityOwner, init)`
  attaches all four and throws when one is already present. Removing
  `AbilityOwner` removes all four. The wrapper component classes and the
  `get*Component` helpers are gone. Read state with `abilityOwnerOf`,
  `attributesOf`, `activeEffectsOf`, and `gameplayTagsOf`.
- `releasePooledAbilityState`, installed by `createAbilitySystem`,
  records the factory shell on the first call and copies it back on
  later calls. The effect queue and `pendingAdd` are cleared. Attributes,
  the granted ability set, and `AbilityOwner` init tags match a fresh
  spawn. `pendingAdd` is not part of the shell, so `onSpawn` re-seeds it.
  Restore passes `onEnable('restore')` and does not reseed, so the
  snapshot's pending list is kept.
- Saved ability ids, gameplay tags, ad-hoc tags, and effect-grant counts
  are sorted by UTF-16 code unit. The section version stays 1. The reader
  accepts either order.

Peers are `@phalanx-engine/ecs` and `@phalanx-engine/math` at
`workspace:^` (published as `^0.3.0`).

### @phalanx-engine/math

- `DeterministicRandom` (`xoroshiro128plus`) lives here. `getState()`
  returns four integer words. `setState` and `fromState` continue that
  sequence. `float`, `floatRange`, and `boolean` stay as deprecated
  wrappers. There are no new float APIs.
- `@phalanx-engine/client` and `@phalanx-engine/server` no longer
  re-export math and no longer depend on this package.

### @phalanx-engine/client

- No dependency on `@phalanx-engine/math`. `PhalanxClient.random` is
  removed. `randomSeed` (`number | null`) remains. After
  `waitForGameStart()`, build the world RNG with
  `new DeterministicRandom(client.randomSeed)` from
  `@phalanx-engine/math` or `@phalanx-engine/game/math`.
- Session resume: `MatchSessionStore` (`phalanx.session.<gameId>`),
  `resumeMatch`, and the `session-token` event. A terminal rejection
  (`invalid`, `expired`, `match-ended`, `build-mismatch`) clears the
  record. `timeout` keeps it. Do not log the token.
- Opt-in relay catch-up: `fetchMatchLog(fromTick)` yields
  `MatchLogChunkEvent`. `requestMatchSnapshot()` resolves a
  `MatchSnapshot` (`bytes` is a plain `Uint8Array`). `serverDesync` fires
  for the socket `desync` event of a server-simulation match.
- Wire types come from `@phalanx-engine/protocol`. `SubmittedCommand` is
  the `submit-commands` body. `PlayerCommand.playerId` and
  `PlayerCommand.tick` are required.

### @phalanx-engine/server

- Server simulation is `new Phalanx({ sim })` with a `ServerSimHook`
  (`createServerSim` from `@phalanx-engine/runtime/server` or
  `@phalanx-engine/game/server`). `PhalanxConfig.games` and `simHost` are
  removed. This package no longer depends on `@phalanx-engine/math`,
  `@phalanx-engine/ecs`, or `@phalanx-engine/runtime`. Validation errors
  use the `Invalid sim.*` prefix.
- Opt-in full command log: `commandHistoryTicks: 'full'`, `match-log` in
  chunks of at most 2000 ticks, and `match-log-cancel`. `buildId`
  (`requireBuildId`) is checked when set.
- Opt-in HMAC session token (`session`), `match-resume` /
  `match-resume-state` / `match-resume-error`, and
  `reconnect.requireSessionToken`. The token is signed, not encrypted.
  Do not log it.
- Opt-in absence timer in `playing` (`absence: { windowMs, matchBudgetMs }`).
  `match-end` can include `winnerTeamId`. `reason` is `'disconnect'` or
  `'abandoned'`. `GameRoom.endMatch()` is public.
- `Phalanx.shutdown()` emits `server-shutdown` and, when `handleSignals`
  is set, runs on `SIGTERM`. `shutdownGraceMs` bounds pending archive
  hooks.
- Wire types are imported from `@phalanx-engine/protocol` and
  re-exported. Player ids `system` and `bot:<slot>` are rejected on queue
  and room inputs and on human slots.

### Migration from 0.2.3

- Depend on `@phalanx-engine/*` at `0.3.0`. Physics and abilities declare
  their ecs and math peers as `^0.3.0` once published.
- Import the facade from `@phalanx-engine/game` and the subpaths in the
  table above. Do not import fixed-point math from the client or the
  server, and do not read `client.random`.
- Construct `GameWorld` with `tickFrameProvider` and
  `random: new DeterministicRandom(seed)`. Use `world.eventBus`. Create
  entities with `world.createEntity` or `world.createEntityWithId`.
- Call `PhysicsWorld.attach(world)` and
  `createAbilitySystem(world, config)` before `world.start()`. Add game
  systems with `world.addSystem(system, { phase })`. Read physics and
  abilities through `context.getService`.
- Replace `world.save` / `restore` / `spawn` / `despawn` / `each` with
  `saveWorld`, `restoreWorld`, `spawn`, `despawn`, and `each`.
- Replace `new Phalanx({ games, simHost })` with
  `new Phalanx({ sim: createServerSim({ games }) })`.
- Snapshots are format 3. A format 2 snapshot does not load.
