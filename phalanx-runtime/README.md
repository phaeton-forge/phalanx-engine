# @phalanx-engine/runtime

> **Status: Tasks 1–4 implemented.** Contracts and types are final for
> engine 0.3. `StateHelpers` covers SoA stores, entity ids, pools, RNG and
> broadphase centers. GAS helpers and the match runner still throw
> `not implemented: <member> (Task NN)`. The package is `private` until the
> synchronized 0.3.0 release.

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
  the entity id counter, `spawnWithId`, pool membership, RNG state and
  broadphase centers are implemented. GAS helpers are still Task 5.
  Recreate entities before `readSoAStores`. Restore broadphase with
  `readBroadphase` (pre-separation centers, including radius and each
  value's precision). `rebuildPhysics` is only for a collision-free world.
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
`checkSnapshotCompatibility`, and `StateHelpers` except
`writeAbilities` / `readAbilities`. There is no `f32` or `f64` writer.

`readPools` adopts entities that were already recreated with `spawnWithId`
(`PoolManager.restore` does not construct them). Pool type keys stay in
registration order. RNG state is `getState` / `setState` (four int32
words).

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
