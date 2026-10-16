---
name: phalanx-runtime
description: Describe a Phalanx game as one GameDefinition and run it with MatchRunner from @phalanx-engine/runtime (engine 0.3). Use when defining games with defineGame, implementing the GameState save/restore contract, writing BotPolicy bots, choosing simMode 'client' vs 'server', snapshots, replays, reconnect, or Transport/LocalTransport. Canonical state bytes, StateHelpers (including GAS), MatchRunner, LocalTransport and the bot host are implemented. MatchRunner.join is still Task 12.
metadata:
  author: phaeton2040-AI
  version: '0.1'
---

# Phalanx Runtime Skill

> **Status: Tasks 1–6 implemented. `MatchRunner.join` is still Task 12.**
> Task 3 is engine hooks (ecs id counter, SoA context, pools, math RNG
> state, ability runtime export, broadphase centers). Task 4 is
> `StateHelpers` except GAS. Task 5 is `writeAbilities` / `readAbilities`.
> Task 6 is `MatchRunner` (not `join`), `CommandLog`, `WorldScope`,
> `BotHost` and in-memory `LocalTransport`. `BinaryStateWriter` /
> `BinaryStateReader`, `encodeSnapshot` / `decodeSnapshot`, `digestBytes`,
> `canonicalConfigBytes`, `configHash` and `checkSnapshotCompatibility` are
> live. Later members throw `NotImplementedError` with
> `not implemented: <member> (Task NN)`. Check `docs/design/runtime-api.md`
> § Task map before relying on a member.

## When to Use This Skill

- Defining a game for engine 0.3 (`defineGame`, `GameDefinition`).
- Implementing `GameState` (snapshots, reconnect, server simulation).
- Writing bots as command producers (`BotPolicy`).
- Choosing `simMode: 'client' | 'server'` and slots (`SlotConfig`).

## Modes

- `client`: devices simulate; local bots (`runsOn: 'local'`); local
  snapshot every 300 ticks.
- `server`: the server is a lockstep peer; server bots
  (`runsOn: 'server'`); the server arbitrates digests and serves fresh
  snapshots. Only commands cross the wire.

## Rules

1. `createWorld(config, ctx)` builds `new GameWorld({ tickFrameProvider:
ctx.tickFrameProvider, random: ctx.random, ... })` and calls
   `world.start()`. Never call `processAllTicks`.
2. `ctx.purpose === 'restore'`: build static content only;
   `GameState.restore` recreates dynamic entities.
3. Commands: `decode` is structural (no sim); `validate` is pure and reads
   the sim; `applyCommand` mutates. Payloads are JSON-safe; send FP raw
   values as decimal strings.
4. `GameState.save` uses only `StateWriter` primitives; no floats, no
   `JSON.stringify`. Use `list` for containers whose order the simulation
   observes and `sortedBy` for id-keyed containers.
5. `restore(save(x))` must re-save to identical bytes, and a restored world
   must produce the same digest as the original every tick.
6. Bot state is NOT `GameState`. Use `BotPolicy.save/restore`. A finished
   replay never runs the bot. Local resume does: with a log tail, `decide`
   runs during catch-up and submits only commands past `throughTick`.
7. A bot's `decide(sim, tick)` must not mutate `sim`; its commands run at
   `tick + inputDelayTicks`. A snapshot also stores the not-yet-delivered
   submits (the input checkpoint), outside the digest.
8. Match configs are JSON-safe with integer numbers only.
   `configHash(config)` is `digestBytes(canonicalConfigBytes(config))`:
   object keys sorted by UTF-16 code unit, safe integers only.

## State helpers

Call these inside the game's own `GameState`, in this order on restore:
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
  simulation. `rebuildPhysics` rebuilds from current transforms and is
  valid only before the first resolving step.

## Running a match

```ts
const transport = new LocalTransport({ tickRate: game.tickRate });
const runner = new MatchRunner(game, config, transport, { side: 'client' });
runner.start();
runner.submit({ type: 'move', dx: 1n }); // executes at tick + inputDelayTicks
```

Tests and replays use `LocalTransport.manual()` and `step(n)`.
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
Live command payloads are canonicalized (UTF-16 key order) so a restored
log matches the live log. `LocalTransport` rejects a submit more than
`maxAheadTicks` past `nextTick` (default 8). Its timer waits
`tickDuration - accumulator`. A snapshot taken
after `decide` stores bot bytes and the input checkpoint outside the
digest. `restore` applies those only for slots this runner hosts or
submits, so a client ignores a server snapshot's bot state and checkpoint.

## Canonical state bytes

`BinaryStateWriter` / `BinaryStateReader` are the snapshot codec.
Little-endian, lengths and counts as unsigned LEB128, no `f32` / `f64`.
`list` writes the given order (effect queues, pool free lists). `sortedBy`
sorts by a unique integer key and throws on duplicates or non-integers.
`section` is `str(key)`, `varint(version)`, `varint(byteLength)`, body, and
the reader must consume the body exactly. `str` rejects unpaired UTF-16
surrogates, so a lone surrogate cannot share bytes with U+FFFD. That covers
canonical config keys and values. The reader keeps a leading U+FEFF.

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

## References

- `docs/design/runtime-api.md`: all contracts, review findings, task map.
- `docs/design/server-sim.md`, `docs/design/reconnect.md`.
- `phalanx-runtime/tests/fixtures/tinyGame.ts`: the Task 6 fixture
  (`spawn` / `move`, walker bot, SoA position and hp).
