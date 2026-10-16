# @phalanx-engine/runtime

> **Status: Tasks 1–6 implemented.** Contracts and types are final for
> engine 0.3. `StateHelpers` covers SoA stores, entity ids, pools, RNG,
> broadphase centers and GAS (abilities). `MatchRunner` drives a game from
> any `Transport`, with an in-memory `LocalTransport`, `CommandLog`,
> `WorldScope` and `BotHost`. `MatchRunner.join` is still Task 12. The
> package is `private` until the synchronized 0.3.0 release.

Isomorphic match runtime for Phalanx games (no DOM, no sockets). A game
describes itself as one `GameDefinition`; the engine's `MatchRunner` drives
it from any `Transport`, records the command log, computes state digests and
takes and restores snapshots through the game's own `GameState`.

## Two modes

Chosen per match by `MatchConfigBase.simMode`:

- **`client`**: only devices simulate (offline with local bots, or relay
  lockstep). Reconnect uses a local snapshot every 300 ticks plus the log.
- **`server`**: still lockstep, but the server is a peer. It runs the same
  simulation headlessly, injects server-bot commands, arbitrates digests and
  serves fresh snapshots on reconnect. Only commands cross the wire.

## Contracts

```ts
import { defineGame, rejectCommand } from '@phalanx-engine/runtime';

export const MyGame = defineGame({
  id: 'my-game', // = server gameTypes[].gameType
  simVersion: 'my-game-1', // change on any simulation change
  tickRate: 10, // = server tickRate
  createWorld: (config: MyConfig, ctx) => new MySim(config, ctx),
  commands: {
    types: ['move'],
    decode: (raw, slot) => parseMove(raw) ?? rejectCommand('bad move'),
    validate: (cmd, slot, sim) => null, // pure, in-sim, every peer
    encode: (cmd) => ({ type: 'move', x: cmd.x.toString() }),
  },
  state: { formatVersion: 1, bind: (sim) => new MyState(sim) },
  bots: { standard: (config, slot, rng) => new MyBot(slot.level, rng) },
  outcome: (sim) => sim.winner(),
});
```

- **`GameState { save(w), restore(r) }`**: implemented by the game; the
  engine calls it without knowing the format. Canonical bytes only (no
  floats; FP values as raw `i64`). `restore(save(x))` must re-save to
  identical bytes.
- **`StateHelpers`**: optional helpers a game may call inside its
  `GameState`. SoA rows (explicit schema names; `f32` / `f64` skipped),
  the entity id counter, `spawnWithId`, pool membership, RNG state,
  broadphase centers and GAS state are implemented. Restore order:
  `spawnWithId` for non-pooled entities, `readPools` (constructs pooled
  entities and discards prewarmed free ones; free entities get `onDespawn`
  again), `readSoAStores`, `readAbilities`, `readEntityIds`, `readRandom`,
  `readBroadphase`. A zero-row SoA section registers a
  missing empty store; a saved id with no row still throws, and a row
  the section omitted throws `extra entity`. Restore broadphase with
  `readBroadphase` (pre-separation centers, including radius and each
  value's precision). That also fills `lastX` / `lastZ` for the first
  frame. Do not read `lastX` / `lastZ` in simulation. `rebuildPhysics`
  is only for a collision-free world.
- **`BotPolicy`**: a bot is a command producer for its slot, not a
  simulation system. Its commands enter the same log as humans'.
- **`Transport`**: extends ecs `ITickFrameProvider` with `submit` and
  optional network methods. `LocalTransport` is the offline transport.
- **`createWorld`** must construct its `GameWorld` with
  `{ tickFrameProvider: ctx.tickFrameProvider, random: ctx.random }` and call
  `world.start()`.

Implemented today: `defineGame`, the constants (`ENGINE_SNAPSHOT_FORMAT`,
snapshot intervals, …), `botPlayerId` / `isBotPlayerId`, `rejectCommand` /
`isCommandRejection`, `NotImplementedError`, `BinaryStateWriter` /
`BinaryStateReader` (`list` keeps order, `sortedBy` sorts unique integer
keys), `encodeSnapshot` / `decodeSnapshot` (header, body, and optional bot
state and input checkpoint outside the digest), `digestBytes` (xxhash64,
seed 0), `canonicalConfigBytes` / `configHash`,
`checkSnapshotCompatibility`, `StateHelpers` including
`writeAbilities` / `readAbilities` (`section('gas', 1)`), and the offline
runner: `MatchRunner`, `CommandLog`, `WorldScope`, `BotHost` and
`LocalTransport` (timer or `LocalTransport.manual()` + `step`). There is
no `f32` or `f64` writer.

`MatchRunner` emits each tick on a runner-owned `ITickFrameProvider`, so
`createWorld` must call `world.start()`. Commands are sorted by `(slot, seq)`
and validated inside the tick; rejected entries stay in the log.
`snapshot` runs after hosted `decide` and stores bot state plus the input
checkpoint outside the digest. `restore` rebuilds with
`purpose: 'restore'`, checks the round trip, then applies bot state and
the checkpoint only for slots this runner hosts or submits. `createWorld`
must not spawn entities when `purpose` is `'restore'`. `GameState.restore`
recreates them by id. A spawn during `'restore'` throws
`spawnWithId: entity N already exists`. A client
restoring a server snapshot ignores both. `fastForward(entries, { budgetMs,
throughTick })` is inclusive and runs empty ticks. `fromReplay` never
calls `decide`. Drive that runner only with
`fastForward(replay.log, { throughTick: replay.lastTick })`; `start()`
throws. `WorldScope.run` isolates the entity id counter and the
SoA entity manager so two matches can share a process.

A malformed envelope is logged and rejected with `'malformed envelope'`
instead of throwing. Exceptions from `decode` and `validate` become
rejections too (`error.message`, or `'decode failed'` / `'validate failed'`).
A throw from the tick itself calls `onError(error, tick)`, sets `status`
to `'failed'`, stops the transport, and leaves `tick` on the last
completed tick. The error is rethrown so a manual `step` still surfaces
it. A bot `decide` that throws is isolated: it is logged with
`console.error`, that slot submits nothing, and the match continues.
Policy state may already be partial. The first non-null `outcome` is
emitted once; `status` becomes `'ended'` and the transport stops.
`status` is `'ready' | 'running' | 'ended' | 'failed' | 'disposed'`.
Live log payloads are stored with canonical object-key order so they
match a checkpoint restored into another runner.

`LocalTransport` rejects `submit` when
`targetTick > nextTick + maxAheadTicks` (default 8) so the pending map
stays bounded. Each prepared tick seeks a local transport to `tick + 1`
first, which is where a live clock already sits, so a catch-up submit
uses the same horizon. The timer waits `tickDuration - accumulator`
instead of spinning on a zero delay. A throw from the timer handler
stops the clock and does not reschedule.

`writeAbilities` stores the per-world runtime from `exportRuntimeState`
(instance-id counter, activation queue, `currentTick`, resolved
activations). The cue buffer is not included. Each registered entity that
has a GAS component is written in ascending id order, with flags so lazy
components are created on read. Free-list entities are omitted.
`releasePooledAbilityState` records the factory shell on the first return
(attribute `base` / `current` / `dirty`, the equipped ability set, and
ad-hoc tags plus effect grants, including `initComponent` tags). Later
returns clear the effect queue and `pendingAdd`, copy that shell back,
and remove GAS components attached after it (a bare pooled entity that
gained `ActiveEffects` or `GameplayTags` during its life is dormant
without them). Initial `pendingAdd` effects are not in the shell, so
`onSpawn` must re-seed those. A respawn whose `onSpawn` does not rewrite
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
