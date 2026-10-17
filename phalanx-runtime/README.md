# @phalanx-engine/runtime

> **Status: Tasks 1–6, 6.5a and 6.5b implemented.** A game is
> `defineComponent` + `defineCommands` + `defineGame` + `runLocalMatch`.
> The engine owns the world. Low-level section helpers live in
> `@phalanx-engine/runtime/advanced`. `MatchRunner.join` is still Task 12.
> The package is `private` until the synchronized 0.3.0 release.

Isomorphic match runtime for Phalanx games (no DOM, no sockets). A game
describes itself as one `GameDefinition`; `MatchRunner` drives it from any
`Transport`, records the command log, computes state digests and restores
snapshots. The game-facing imports are re-exported from
`@phalanx-engine/engine`.

## Two modes

Chosen per match by `MatchConfigBase.side` (the local peer). `runsOn` on a
bot slot is independent of `side`: a client match can watch server bots.

- **`client`**: only devices simulate (offline with local bots, or relay
  lockstep). Reconnect uses a local snapshot every 300 ticks plus the log.
- **`server`**: still lockstep, but the server is a peer. It runs the same
  simulation headlessly, injects server-bot commands, arbitrates digests and
  serves fresh snapshots on reconnect. Only commands cross the wire.

## Contracts

```ts
import {
  defineCommands,
  defineComponent,
  defineGame,
  runLocalMatch,
} from '@phalanx-engine/engine';

const Unit = defineComponent('Unit', { x: 'i64' });
const commands = defineCommands({ move: { dx: 'i64' } });

export const MyGame = defineGame({
  id: 'my-game', // = server gameTypes[].gameType
  simVersion: 'my-game-1', // change on any simulation change
  tickRate: 10, // = server tickRate
  components: [Unit], // registered in this order before onStart
  commands, // codec + schema; folded into configHash
  onStart(ctx) {
    if (ctx.purpose === 'fresh') ctx.world.spawn({ Unit: { x: 0n } });
  },
  onCommand: {
    move(ctx, stamped) {
      ctx.world.each(Unit, (unit) => {
        unit.x += stamped.command.dx;
      });
    },
  },
  bots: {
    walker: () => ({ decide: () => [{ type: 'move' as const, dx: 1n }] }),
  },
  checkOutcome: () => null,
});

const match = runLocalMatch(MyGame, {
  seed: 1,
  stepped: true,
  slots: [{ kind: 'human' }, { kind: 'bot', policy: 'walker' }],
});
```

`save` may be omitted. `defineGame` then returns a copy whose handler is
the world modules (`formatVersion` 1). When `save` is present,
`defineGame` returns that same object. `onCommand` is a function or an
exhaustive handler map. `defineCommands` rejects a bad payload and does
not throw. `i64` is a canonical decimal string on the wire.

- **`defineComponent(name, fields, { defaults? })`**: a named SoA schema.
  Register it with `world.registerComponent` before the first spawn.
  Registration order and each field's name and type are part of
  `configHash` (an empty list keeps the previous hash). A field type
  outside `i32`, `u32`, `u8`, `i64`, `f32`, `f64` throws at definition
  time and names the allowed types. `f32` / `f64` are then rejected
  because they are not saved. Names `roster`, `pools`, `entityIds`,
  `random`, `broadphase`, `gas`, and `SoASchema` are reserved.
- **`world.save()` / `world.restore(bytes)`**: roster (only when a
  non-pooled entity exists), pools, SoA stores, abilities (when GAS is
  attached), the entity id counter, RNG, broadphase centers (when a grid
  is attached), then optional `bindWorldSingletons` hooks. Section bytes
  match a manual `StateHelpers` save. Before those sections are read,
  `restore` returns every checked-out pooled entity and removes entities
  whose ids are not in the roster. Missing roster ids are empty shells.
  Each SoA section then attaches only the components it lists. A roster
  id world creation already spawned is kept and its rows are overwritten.
  `onEnable` runs after the bytes land and must not overwrite saved
  fields.
- **`world.spawn({ Unit: { hp: 48n } })` / `world.despawn(entity)` /
  `world.each(Unit, (row) => { ... })`**: the same entity id counter as
  `new Entity()`. `each` walks rows in ascending id. The callback receives
  one view object reused for every row. Do not store it, and do not read
  it after the callback returns. Each access looks up the entity's current
  row, so despawning a different entity inside the callback does not
  redirect the write. Accessing a row after that entity was removed throws.
- **`SaveHandler { save(w), restore(r) }`** (advanced): implemented by
  the game when the default modules are not enough. Pass it as
  `save: { formatVersion, handler(sim) }`. Canonical bytes only (no
  floats; FP values as raw `i64`). `restore(save(x))` must re-save to
  identical bytes.
- **`@phalanx-engine/runtime/advanced`**: `StateHelpers`, `spawnWithId`,
  `rebuildBroadphaseFromTransforms` and `WorldScope`. These are not on
  the package root. SoA rows (explicit schema names; `f32` / `f64`
  skipped), the entity id counter, pool membership, RNG state, broadphase
  centers and GAS state are implemented. Restore order: `spawnWithId` for
  non-pooled entities, `readPools` (constructs pooled entities and
  discards prewarmed free ones; free entities get `onDespawn` again),
  `readSoAStores`, `readAbilities`, `readEntityIds`, `readRandom`,
  `readBroadphase`. A zero-row SoA section registers a missing empty
  store; a saved id with no row still throws, and a row the section
  omitted throws `extra entity`. Restore broadphase with `readBroadphase`
  (pre-separation centers, including radius and each value's precision).
  That also fills `lastX` / `lastZ` for the first frame. Do not read
  `lastX` / `lastZ` in simulation.
  `rebuildBroadphaseFromTransforms` is only for a collision-free world.
  `spawnWithId` throws `spawnWithId: entity N already exists` when that
  id is already registered. `world.restore` does not.
- **`BotPolicy`**: a bot is a command producer for its slot, not a
  simulation system. Its commands enter the same log as humans'.
- **`Transport`**: extends ecs `ITickFrameProvider` with `submit` and
  optional network methods. `LocalTransport` is the offline transport.
- **`onStart`** receives the engine-owned world. Call `ctx.open()` before
  spawning pooled entities (it prewarms and calls `world.start()`). The
  engine calls `open` if `onStart` returns without it. Return a custom
  sim object, or return nothing and the engine keeps `{ world }`.

Implemented today: `defineGame`, the constants (`ENGINE_SNAPSHOT_FORMAT`,
snapshot intervals, …), `botPlayerId` / `isBotPlayerId`, `rejectCommand` /
`isCommandRejection`, `NotImplementedError`, `BinaryStateWriter` /
`BinaryStateReader` (`list` keeps order, `sortedBy` sorts unique integer
keys), `encodeSnapshot` / `decodeSnapshot` (header, body, and optional bot
state and input checkpoint outside the digest), `digestBytes` (xxhash64,
seed 0), `canonicalConfigBytes` / `configHash`,
`checkSnapshotCompatibility`, `defineComponent`, `bindWorldSingletons`,
and the offline runner: `MatchRunner`, `ReplayPlayer`, `runLocalMatch`,
`CommandLog`, `BotHost` and `LocalTransport` (timer or
`LocalTransport.stepped()` + `step`). Local persistence is opt-in:
`MemoryMatchStore`, `IndexedDbMatchStore` and `MatchRunner.resumeLocal`.
`StateHelpers` (including `writeAbilities` / `readAbilities`,
`section('gas', 1)`), `spawnWithId`, `rebuildBroadphaseFromTransforms`
and `WorldScope` are exported from `@phalanx-engine/runtime/advanced`.
There is no `f32` or `f64` writer.

`MatchRunner` emits each tick on a runner-owned `ITickFrameProvider`.
`ctx.open()` calls `world.start()`. Commands are sorted by `(slot, seq)`
and validated inside the tick; rejected entries stay in the log.
Importing `@phalanx-engine/runtime` calls `setWorldModuleHost` once and
installs that host for the process. Without that import, `GameWorld.save`, `restore`, `spawn`, `despawn` and
`each` throw `GameWorld: world modules are not installed. Import @phalanx-engine/runtime before using save, restore, spawn, despawn, or each.`
`setWorldModuleHost` lives on `@phalanx-engine/ecs`; games do not call it.
`each` passes one reused view. Do not store it. A write after that entity
was despawned throws.

`snapshot` runs after hosted `decide` and stores bot state, the input
checkpoint, and the registered component schemas outside the digest.
`restore` compares those schemas with the booted world before it applies
the body. A field rename, reorder, or type change throws, for example
`component 'Unit' schema changed: expected x:i32,hp:u32, got hp:u32,x:i32`.
The SoA section bytes themselves are unchanged. `restore` rebuilds with
`purpose: 'restore'`, checks the round trip, then applies bot state and
the checkpoint only for slots this runner hosts or submits. `onStart`
must not spawn entities when `purpose` is `'restore'` if a custom save
handler calls `spawnWithId` for those ids. The default world-module
restore skips an id that already exists. A client
restoring a server snapshot ignores both. `side` is omitted from
`configHash`, so the two peers share a hash. `fastForward(entries, { budgetMs,
throughTick })` is inclusive and runs empty ticks. `ReplayPlayer.from`
never calls `decide` and has no `start` or `submit`. Drive it with
`play({ budgetMs })` or `fastForward(throughTick)`. A final-digest
mismatch throws. `runner.setController(slot, 'human' | 'bot', { fromTick?, policy? })`
records a system command (player id `system`), applied at the start of
`fromTick` before game commands. The default `fromTick` is
`tick + inputDelayTicks`. `inputDelayTicks` defaults to 2. `gameId` and
`simVersion` are filled from the definition. `WorldScope.run` isolates the entity id counter and the
SoA entity manager so two matches can share a process.

A malformed envelope is logged and rejected with `'malformed envelope'`
instead of throwing. Exceptions from `decode` and `validate` become
rejections too (`error.message`, or `'decode failed'` / `'validate failed'`).
A throw from the tick itself calls `onError(error, tick)`, sets `status`
to `'failed'`, stops the transport, and leaves `tick` on the last
completed tick. `LocalTransport.stepped().step()` does not rethrow that
error; `onError` already received it. `fastForward`, replay, and catch-up
still propagate it, including a final-digest mismatch. A timed transport swallows it
inside its timer. Any other transport still sees the exception. A bot
`decide` that throws is isolated: it is logged with
`console.error`, that slot submits nothing, and the match continues.
Policy state may already be partial. The first non-null `checkOutcome` result is
emitted once; `status` becomes `'ended'` and the transport stops.
`status` is `'ready' | 'running' | 'ended' | 'failed' | 'disposed'`.
Live log payloads are stored with canonical object-key order so they
match a checkpoint restored into another runner. The payload codec
round-trips every finite JSON number. `canonicalConfigBytes` still
accepts only safe integers. `toReplay()` throws when the command log
is incomplete: a restore onto a runner that did not record ticks `0..N`,
or a log truncation. The replay format has no base snapshot.
`checkOutcome` and the digest are published after the tick has completed
and after hosted `decide`. A transport without `requestPause` /
`requestResume` cannot pause the world. Catch-up drops buffered
batches covered by the replayed range and then runs the rest in order.
An already-started runner flushes its checkpoint after `restore`.
`restore` resets the match RNG to `config.seed` before `onStart`,
then the save handler installs the saved generator, and a paused
transport pauses the rebuilt world. `WorldScope` saves the active
scope's registers before entering another scope.

`LocalTransport` rejects `submit` when
`targetTick > nextTick + maxAheadTicks` (default 8) so the pending map
stays bounded. Each prepared tick seeks a local transport to `tick + 1`
first, which is where a live clock already sits, so a catch-up submit
uses the same horizon. The timer waits `tickDuration - accumulator`
instead of spinning on a zero delay. A throw from the timer handler
stops the clock and does not reschedule.

Pass `store` to persist a local match. Without it, `LocalTransport` does
not snapshot or write a log. `snapshotEveryTicks` defaults to 300 (tick 0
is never a snapshot) and `pauseWhenHidden` defaults to true. A host with
no `document` ignores the pause. Hiding the page pauses; showing it does
not resume. On a snapshot tick the runner seals `world` save bytes, the
bot section and the input checkpoint (`systemSeq` and every slot's
controller mode). The body buffer is the one `BinaryStateWriter.finish()`
already returned; it is not copied again. `encodeSnapshot` / digest and
the store write run off the tick (`setImmediate` in Node,
`requestIdleCallback` in browsers). Writes batch every 5 seconds and on
`visibilitychange: hidden` / `pagehide`. Only the last two snapshots are
kept. The stored cursor includes empty ticks, so
`MatchRunner.resumeLocal(definition, store, matchId)` can fast-forward
past the last command. It returns `null` when the id is unknown, does not
start the clock, and leaves `systemSeq` and controller modes as they were
at the snapshot. `runner.whenPersisted()` resolves when the latest flush
has finished. `lastPersistenceSyncMs` is host time spent sealing that
tick, not the digest and not the IndexedDB write. `IndexedDbMatchStore`
reads `globalThis.indexedDB` when a method runs. Node tests install
`fake-indexeddb` first. `runLocalMatch` accepts the same `store`,
`snapshotEveryTicks` and `pauseWhenHidden` options; omitting them keeps
the previous transport.

`writeAbilities` stores the per-world runtime from `exportRuntimeState`
(instance-id counter, activation queue, `currentTick`, resolved
activations). The cue buffer is not included. Each registered entity that
has a GAS component is written in ascending id order, with flags so lazy
components are created on read. Free-list entities are omitted.
The pool records the factory shell on the first return
(attribute `base` / `current` / `dirty`, the equipped ability set, and
ad-hoc tags plus effect grants, including `initComponent` tags). Later
returns clear the effect queue and `pendingAdd`, copy that shell back,
and remove GAS components attached after it (a bare pooled entity that
gained `ActiveEffects` or `GameplayTags` during its life is dormant
without them). Initial `pendingAdd` effects are captured before that
clear. The next `onEnable` copies them back. `world.restore` calls
`onEnable('restore')`, which does not reseed, because the snapshot
already wrote `pendingAdd`. A respawn whose `onSpawn` does not rewrite
attributes matches a restored copy.
`readAbilities` refills `queue` and `pendingAdd` by clearing each array
and appending entries one at a time, so a large list does not hit the
JavaScript argument limit and the arrays keep their identity. Attribute
`base` / `current` are raw `i64`s and `dirty` is a `u8`. Fixed-point payloads (`providedTarget`,
`capturedMagnitudes`, `setByCaller`) store raw `base` and `precision` as
`i64`, the same encoding as broadphase centers. The effect queue and
`pendingAdd` keep array order. Granted abilities, tags, ad-hoc tags and
effect-grant counts keep insertion order. `setByCaller` keys are sorted;
a value must be a safe integer, bigint, string, boolean, or FixedPoint,
and any other type throws. Cooldowns are effects and tags. There is no
`stacks` field.

`readAbilities` parses and validates the whole `gas` section before it
changes the world. An ability id or effect def id that is not in this
world's registries throws, and the message includes the entity id. The
instance-id counter must be `>=` every instance id in an effect queue.
Pending adds have no instance id, so they do not raise that floor. A
failed read leaves the world as it was.

`readPools` calls `PoolManager.createForRestore` for each owned id, then
`restore`. Prewarmed free entities from `world.start()` are discarded
first. Free-list entities receive dormant hooks again on the restored
instance (`onDespawn`, component hooks, and return-to-pool hooks,
including the GAS reset); keep those hooks idempotent. `readEntityIds`
then installs the
saved counter. Pool type keys stay in registration order. RNG state is
`getState` / `setState` (four int32 words). Abilities is a dependency and
a peer. Physics and math are peers; physics is optional.

## Design docs

- [`docs/design/runtime-api.md`](../docs/design/runtime-api.md): contracts,
  review and task map.
- [`docs/design/server-sim.md`](../docs/design/server-sim.md): architecture.
- [`docs/design/reconnect.md`](../docs/design/reconnect.md): reconnect.

## Scripts

```bash
pnpm --filter @phalanx-engine/runtime build
pnpm --filter @phalanx-engine/runtime test # tsc type tests + vitest
```
