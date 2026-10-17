---
name: phalanx-runtime
description: Describe a Phalanx game as one GameDefinition and run it with MatchRunner from @phalanx-engine/runtime (engine 0.3). Use when defining games with defineGame, defineCommands, defineComponent, onCommand, runLocalMatch, ReplayPlayer, setController, world.save/restore, writing BotPolicy bots, choosing side 'client' vs 'server', snapshots, replays, reconnect, or Transport/LocalTransport. Local persistence is opt-in via MatchStore, MemoryMatchStore, IndexedDbMatchStore and MatchRunner.resumeLocal. World modules are the default save handler. StateHelpers, spawnWithId, rebuildBroadphaseFromTransforms and WorldScope are in @phalanx-engine/runtime/advanced. MatchRunner.join is still Task 12.
metadata:
  author: phaeton2040-AI
  version: '0.1'
---

# Phalanx Runtime Skill

> **Status: Tasks 1–7, 7.1, 6.5a and 6.5b implemented. `MatchRunner.join` is still Task 12.**
> Task 3 is engine hooks (ecs id counter, SoA context, pools, math RNG
> state, ability runtime export, broadphase centers). Task 4 is
> `StateHelpers` except GAS. Task 5 is `writeAbilities` / `readAbilities`.
> Task 6 is `MatchRunner` (not `join`), `CommandLog`, `WorldScope`,
> `BotHost` and `LocalTransport`. Task 7 is opt-in local persistence
> (`MatchStore`, `MemoryMatchStore`, `IndexedDbMatchStore`,
> `MatchRunner.resumeLocal`). Task 7.1 splits IndexedDB into `meta`,
> command chunks, and snapshots (schema v2 drops pre-0.3.0 v1 rows) and
> makes `resumeLocal` fall back to the previous snapshot.
> Task 6.5a is `defineComponent`,
> `world.save` / `world.restore`, and the `advanced` subpath.
> `BinaryStateWriter` /
> `BinaryStateReader`, `encodeSnapshot` / `decodeSnapshot`, `digestBytes`,
> `initDigest`, `onDigestFallback`,
> `canonicalConfigBytes`, `configHash` and `checkSnapshotCompatibility` are
> live. Later members throw `NotImplementedError` with
> `not implemented: <member> (Task NN)`. Check `docs/design/runtime-api.md`
> § Task map before relying on a member.

## When to Use This Skill

- Defining a game for engine 0.3 (`defineComponent`, `defineCommands`, `defineGame`, `runLocalMatch`).
- Custom snapshots (`save: { handler }`, advanced `SaveHandler`).
- Writing bots as command producers (`BotPolicy`).
- Choosing `side: 'client' | 'server'` and slots (`SlotConfig`). `runsOn` is independent of `side`.

## Modes

- `client`: devices simulate; local bots (`runsOn: 'local'`); local
  snapshot every 300 ticks.
- `server`: the server is a lockstep peer; server bots
  (`runsOn: 'server'`); the server arbitrates digests and serves fresh
  snapshots. Only commands cross the wire.

## Rules

1. `onStart(ctx)` uses the engine-owned `ctx.world`. Call `ctx.open()`
   before spawning pooled entities. The engine calls it if you return
   without doing so. Never call `processAllTicks`.
2. `ctx.purpose === 'restore'`: spawn only what a custom save handler
   will overwrite. `spawnWithId` throws `spawnWithId: entity N already exists`
   for an id that is already registered. `world.restore` skips that id
   and overwrites its rows.
3. `defineCommands` builds `decode`, `encode` and `types`. `decode` never
   throws. `onCommand` is a function or an exhaustive per-type map. The
   game does not parse `StampedCommand` by hand. `i64` is a decimal string
   on the wire.
4. A custom `SaveHandler.save` uses only `StateWriter` primitives; no floats, no
   `JSON.stringify`. Use `list` for containers whose order the simulation
   observes and `sortedBy` for id-keyed containers.
5. `restore(save(x))` must re-save to identical bytes, and a restored world
   must produce the same digest as the original every tick.
6. Bot state is outside the digest. Use `BotPolicy.save/restore`. A finished
   replay never runs the bot. Local resume does: with a log tail, `decide`
   runs during catch-up and submits only commands past `throughTick`.
7. A bot's `decide(sim, tick)` must not mutate `sim`; its commands run at
   `tick + inputDelayTicks`. A snapshot also stores the not-yet-delivered
   submits (the input checkpoint), outside the digest.
8. Match configs are JSON-safe with integer numbers only.
   `configHash(config)` is `digestBytes(canonicalConfigBytes(config))`:
   object keys sorted by UTF-16 code unit, safe integers only. After boot,
   `MatchRunner` folds each registered component's name and its field
   names and types, in registration and declaration order, into that
   digest when the list is non-empty. An empty list keeps the
   one-argument hash. Restore compares the schema text stored outside
   the snapshot digest and throws
   `component 'Unit' schema changed: expected x:i32,hp:u32, got hp:u32,x:i32`
   when the fields differ.

## World and components

```ts
import { defineComponent, defineGame } from '@phalanx-engine/runtime';

const Unit = defineComponent('Unit', { hp: 'i64' }, { defaults: { hp: 48n } });
```

Register with `world.registerComponent(Unit)` before spawn. `world.spawn({
Unit: { hp: 48n } })`, `world.despawn(entity)` and `world.each(Unit, fn)`
use the existing entity id counter. The `each` callback receives one
reused view; do not store it or read it after the callback returns.
Importing `@phalanx-engine/runtime` calls `setWorldModuleHost` once.
`world.save()` / `world.restore(bytes)` are the default `defineGame` state
when `state` is omitted. Restore returns checked-out pool entities, drops
entities that are not in the roster, and attaches components from the SoA
sections. Optional
singleton bytes go through `bindWorldSingletons(world, { onSave, onRestore })`.
Component hooks are `onCreate`, `onEnable`, `onDisable`, `onDestroy`.
`onEnable` also runs after restore and must not overwrite saved fields.
Returning an entity to the pool resets SoA fields to the schema defaults
and resets GAS attributes, the granted ability set, and `initComponent`
tags to the factory shell.

## State helpers

Import them from `@phalanx-engine/runtime/advanced`, not the package root.
Call these inside a hand-written `GameState`, in this order on restore:
`spawnWithId` for non-pooled entities, `readPools`, `readSoAStores`,
`readAbilities`, `readEntityIds`, `readRandom`, `readBroadphase`.

- SoA: `section(<schema name>, 1)` and rows in ascending entity id.
  `defineSoASchema` must be given an explicit unique name. `f32` / `f64`
  fields are skipped. A missing row throws
  `readSoAStore: missing entity <id> in <schema>`. A row the section did
  not list throws `readSoAStore: extra entity <id> in <schema>`. A
  zero-row section whose store is missing (the source removed the last
  entity) is registered empty with `getOrCreateSoAStore`.
- Entity ids: the counter only. `spawnWithId` builds one non-pooled entity
  with that exact id and then `addEntity`s it. `readEntityIds` runs after
  the rows so prewarm and pool allocation cannot leave the counter high.
- Pools: registration order, owned ids in creation order, free list from
  oldest release to newest. `readPools` discards prewarmed free entities
  (`dispose`, not registered), then `PoolManager.createForRestore` builds
  each owned id with the raw factory (no hooks). Checked-out entities are
  registered. Free-list entities get `onDespawn` again on that new
  instance; keep the hook idempotent.
- RNG: four int32 words from `getState` / `setState`. An `IRandom` without
  `getState` throws. Do not use `getGenerator`.
- GAS: `section('gas', 1)`. Per-world runtime via `exportRuntimeState` /
  `importRuntimeState` (instance id counter, activation requests,
  `currentTick`, resolved activations). The cue buffer is omitted.
  Registered entities that have a GAS component are written ascending by
  id, with a flag for which components exist so lazy ones are created on
  read. Free-list entities are omitted. `createAbilitySystem` records the
  factory shell on the first pool return (attribute `base` / `current` /
  `dirty`, the equipped ability set, ad-hoc tags and effect grants,
  including `initComponent` tags). Later returns clear the effect queue
  and `pendingAdd`, copy that shell back, and remove GAS components
  attached after it. `readPools` runs the hook again. Initial `pendingAdd`
  effects are not in the shell, so `onSpawn` must re-seed those. A respawn
  whose `onSpawn` does not rewrite attributes matches a restored copy.
  Effect queue and `pendingAdd`
  stay in array order. `readAbilities` clears each destination array and
  pushes entries one at a time so a large list keeps array identity and
  does not hit the JavaScript argument limit.
  Ability sets, tags, ad-hoc tags and grant counts stay in insertion
  order. `setByCaller` keys are sorted; values are a safe integer, bigint,
  string, boolean, or FixedPoint. Anything else throws. Fixed-point
  `base` and `precision` are both `i64`, matching broadphase centers.
  `readAbilities` parses the section before it mutates. An unknown ability
  id or effect def id throws with the entity id. The instance-id counter
  must be `>=` every queued effect instance id (pending adds have none).
  `dirty` is stored. There is no `stacks` field and no cooldown component.
  Continuation tests compare `digestBytes` of the helper bytes, not
  `StateHasher`.
- Broadphase: `getCenters()` for the `PhysicsWorld` on `context.physics`,
  plus a registered `PhysicsSystem` or `CollisionSystem` when that system
  has a different grid (`physicsSystem` / `collisionSystem`). Each center
  stores entity id, and `x` / `z` / `radius` as raw base plus that value's
  precision. `readBroadphase` calls `restoreBroadphase`, which also writes
  `lastX` / `lastZ` via `FP.ToFloat`. Do not read those fields in
  simulation. `rebuildBroadphaseFromTransforms` rebuilds from current
  transforms and is valid only before the first resolving step.

## Running a match

```ts
const transport = new LocalTransport({ tickRate: game.tickRate });
const runner = new MatchRunner(game, config, transport, { side: 'client' });
runner.start();
runner.submit({ type: 'move', dx: 1n }); // executes at tick + inputDelayTicks
```

Tests and replays use `LocalTransport.stepped()` and `step(n)`.
`fastForward(log, { budgetMs, throughTick })` replays through `throughTick`
inclusive, including empty ticks. `MatchRunner.fromReplay` never calls
`decide`. Drive it only with `fastForward(replay.log, { throughTick:
replay.lastTick })`. `start()` throws on a replay runner. Wrap nothing
yourself: the runner enters the world through `WorldScope`. Two runners
in one process keep separate entity ids.

Validation runs inside the tick, after `(slot, seq)` sort. A malformed
envelope is logged and rejected (`'malformed envelope'`); it does not
throw. A throw from `decode` or `validate` is a rejection too. A throw
from the tick calls `onError(error, tick)`, sets `status` to `'failed'`,
stops the transport, and does not advance `tick`. A bot `decide` that
throws is logged and that slot submits nothing; the match continues, and
policy state may already be partial. The first non-null outcome is
emitted once, then `status` is `'ended'` and the transport stops.
`status` is `'ready' | 'running' | 'ended' | 'failed' | 'disposed'`.
Live command payloads are canonicalized (UTF-16 key order, finite JSON
numbers) so a restored log matches the live log. `canonicalConfigBytes`
still accepts only safe integers. `toReplay()` throws when the command
log is incomplete (restore onto a runner that did not record that
history, or truncation). Do not add a base snapshot to the replay.
`outcome` publishes after the completed tick and after hosted
`decide`. A periodic hash captures the body on the tick and calls
`digestBytes` off the tick. `onDigest(tick, digest)` names that tick.
The callback can run after `runner.tick` has moved past it. A throw
from hashing, `onDigest`, or `submitHash` calls `onError` with that
tick and sets `status` to `'failed'`. `restore` drops digests that
have not been delivered, once the snapshot is accepted.
`runner.flush()` finishes pending digests synchronously;
`await runner.whenIdle()` waits. `LocalTransport.stepped()` does not
flush. Snapshot encode stays on the journal scheduler. The replay final
digest stays synchronous. Server and relay hash checks key by tick
(`receiveStateHash` waits for every connected player), so a digest one
or two frames late still compares. `initDigest()` compiles the embedded
XXH64 module (own `.wat`, 623 bytes). `start`, `runLocalMatch`, and
`ReplayPlayer.from` call it. A cold hash compiles synchronously
(`decodeSnapshot`, `resumeLocal`). `onDigestFallback` fires once only
when compilation fails. Pause requires `requestPause` /
`requestResume` on the
transport. Catch-up applies buffered batches that land after
`throughTick`, in order, and drops the ones the replay already covered.
An already-started `restore` flushes the checkpoint after the transport
seek. `restore` resets the match RNG to `config.seed` before
`createWorld`; `GameState.restore` then installs the saved generator. A
paused transport pauses the rebuilt world. `WorldScope` (advanced) tracks
the active scope: entering a different scope saves that scope's live
registers, and only an immediate re-entry skips install. `LocalTransport`
rejects a submit more than `maxAheadTicks` past `nextTick` (default 8).
Its timer waits
`tickDuration - accumulator`. A snapshot taken
after `decide` stores bot bytes and the input checkpoint outside the
digest. `restore` applies every slot's controller mode from the bot
section. Policy bytes and the checkpoint are applied only for slots this
runner hosts or submits, so a client keeps a server snapshot's
human-to-bot handover and ignores that snapshot's policy state. A custom `GameState` that calls `spawnWithId`
for an id `createWorld` already made still throws
`spawnWithId: entity N already exists`. `world.restore` skips that id.
A throw inside a tick does not escape `LocalTransport.manual().step()`;
`onError` already ran. `fastForward`, replay, and catch-up still
propagate that error, including a final-digest mismatch. A timed
transport swallows the same error in its timer. Other transports still
see it.

## Canonical state bytes

`BinaryStateWriter` / `BinaryStateReader` are the snapshot codec.
Little-endian, lengths and counts as unsigned LEB128, no `f32` / `f64`.
`list` writes the given order (effect queues, pool free lists). `sortedBy`
sorts by a unique integer key and throws on duplicates or non-integers.
`section` is `str(key)`, `varint(version)`, `varint(byteLength)`, body, and
the reader must consume the body exactly. The writer reserves the length,
writes the body in place, then stores a canonical varint and shifts the
body left. A throw inside the body restores `length`. `str` caches UTF-8
for strings of at most 128 characters, at most 4096 entries, and checks
well-formed UTF-16 once, on a miss. Longer strings are encoded every
call and are not cached. It rejects unpaired surrogates, so a lone
surrogate cannot share bytes with U+FFFD. That covers canonical config
keys and values. The
reader keeps a leading U+FEFF.

`encodeSnapshot` wraps the body in a `PHXS` header. `engineFormat`,
`formatVersion` and `tick` are varints. `digestBytes` is xxhash64 (seed 0,
16 lowercase hex chars) of the body only. `botState` and `inputCheckpoint`
follow the body and are not part of the digest. `null` omits an extra;
an empty `Uint8Array` stores it.

`checkSnapshotCompatibility` returns `accept`, `migrate` (`migrations[v]` is
the step from version `v` to `v + 1`; every step from the stored format up
to the current one must be present), or `reject`. A `simVersion` mismatch
rejects. `decodeSnapshot` throws `SnapshotRejectedError` for a bad magic, a
truncated buffer, trailing bytes, or a digest that does not match the body.

## Minimal game

```ts
import { defineGame, rejectCommand } from '@phalanx-engine/runtime';

export const TinyGame = defineGame({
  id: 'tiny',
  simVersion: 'tiny-1',
  tickRate: 10,
  createWorld: (config: TinyConfig, ctx) => new TinySim(config, ctx),
  commands: {
    types: ['stop'],
    decode: (raw) =>
      isStop(raw) ? { type: 'stop' as const } : rejectCommand('unknown'),
  },
  state: { formatVersion: 1, bind: (sim) => new TinyState(sim) },
  outcome: () => null,
});

class TinyState implements GameState {
  constructor(private readonly sim: TinySim) {}
  save(w: StateWriter): void {
    w.section('units', 1, (s) =>
      s.list(this.sim.units, (u, iw) => {
        iw.u32(u.id);
        iw.i64(u.x);
      })
    );
  }
  restore(r: StateReader): void {
    const units = r.section('units', (s) =>
      s.list((ir) => ({ id: ir.u32(), x: ir.i64() }))
    );
    this.sim.units.splice(0, this.sim.units.length, ...units);
  }
}
```

## Local persistence

Opt-in. A `LocalTransport` with no `store` does not write snapshots or a
command log.

```ts
const store = new IndexedDbMatchStore();
const transport = new LocalTransport({
  tickRate: game.tickRate,
  store,
  snapshotEveryTicks: 300, // default
  pauseWhenHidden: true, // default; no document → no pause
});
```

`snapshotEveryTicks` counts completed ticks. Tick 0 is not a snapshot.
The tick path seals the world body, the bot section and the input
checkpoint, and passes the body buffer through without copying it again.
A tick that is both a hash tick and a snapshot tick saves the world once
and passes that buffer to the journal and to the deferred digest.
`encodeSnapshot`, the IndexedDB write, and the periodic hash run off the
tick (`setImmediate` in Node, `requestIdleCallback` in browsers, otherwise
`MessageChannel` or `setTimeout(0)` — not a microtask). `runner.flush()`
does not commit the store. Flushes batch every 5s and on hide /
`pagehide`. The store keeps the last two snapshots. The cursor includes
empty ticks.

```ts
const resumed = await MatchRunner.resumeLocal(game, store, matchId, {
  snapshotEveryTicks: 300, // default
  pauseWhenHidden: true, // default
  hashEveryTicks: 60, // RunnerOptions; default
});
if (resumed === null) return; // nothing saved
resumed.start(); // resumeLocal does not start the clock
```

Resume restores controller mode for every slot and `systemSeq`, then
fast-forwards the tail through the stored cursor. `LoadedMatch.previous`
is the older snapshot. A failed `restore` tries that snapshot on a new
runner and, after catch-up, deletes the rejected tick when the store
implements `deleteSnapshot`. That delete refuses to remove the only
remaining snapshot once a covered command has been dropped.
`runner.resumeReport` is null until
`resumeLocal` returns. `onSnapshotFallback` runs only when a snapshot
was skipped. Every snapshot failing throws `MatchResumeError` and leaves
the store in place. No stored snapshot replays the log from tick 0. A
snapshot that is already terminal stays ended (`start` throws) and does
not catch up. A fresh match reuses a stored id by clearing that record
once; resume does not. `restore` rejects a snapshot older than the
persisted cursor. IndexedDB schema v2 stores `meta`, one command chunk
per append, and snapshot bytes separately. Upgrade from v1 deletes
`matches` without copying it.
Hiding the page pauses only a started transport. `await runner.whenPersisted()`
before exiting the process. It rejects when the header or the command tail
fails to write. A snapshot encode or snapshot write failure is reported
with `runner.onPersistenceError` and still leaves the header and commands
committed. `lastPersistenceSyncMs` is the synchronous seal cost, including
a world save shared with the digest, not the digest itself and not the
write.

## References

- `docs/design/runtime-api.md`: all contracts, review findings, task map.
- `docs/design/server-sim.md`, `docs/design/reconnect.md`.
- `phalanx-runtime/tests/fixtures/tinyGame.ts`: the Task 6 fixture
  (`spawn` / `move`, walker bot, SoA position and hp).
