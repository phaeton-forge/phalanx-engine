# @phalanx-engine/runtime

The match runtime. A game is one `GameDefinition`. `MatchRunner` drives it
from a transport, records the command log, hashes state, and restores
snapshots. There are no sockets in this package. The debug panel is the
only DOM surface.

Games usually import the same symbols from `@phalanx-engine/game` (and
`/net`, `/server`, `/advanced`). This README is the contract behind those
re-exports.

```bash
pnpm add @phalanx-engine/runtime
```

## Four entry points

| Subpath      | Import                             | Exports                                                                                                                                                                                                         |
| ------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`          | `@phalanx-engine/runtime`          | `defineGame`, `defineCommands`, `defineComponent`, `runLocalMatch`, `MatchRunner`, `ReplayPlayer`, `LocalTransport`, `saveWorld`, `restoreWorld`, `spawn`, `despawn`, `each`, persistence stores, `attachDebug` |
| `./net`      | `@phalanx-engine/runtime/net`      | `ServerPeerTransport`, `ServerPeerTransportOptions`. Optional peer: `@phalanx-engine/client`                                                                                                                    |
| `./server`   | `@phalanx-engine/runtime/server`   | `createServerSim`, `ServerSimConfig`, `GameModuleSpec`                                                                                                                                                          |
| `./advanced` | `@phalanx-engine/runtime/advanced` | `StateHelpers`, `spawnWithId`, `PoolManager`, `SoAComponentStore`, `TickFrameManager`, `DebugPanel`, `Transport`, `TransportJoin`, `TransportCatchUp`, `SaveHandler`, `CommandSchema`                           |

Importing the package root does no work. The server sim worker entry is
the only side effect.

## Define a game

```ts
import {
  defineCommands,
  defineComponent,
  defineGame,
  each,
  GameSystem,
  runLocalMatch,
} from '@phalanx-engine/runtime';
import { FP } from '@phalanx-engine/math';

const Unit = defineComponent('Unit', { x: 'i64', vx: 'i64' });
const commands = defineCommands({ push: { vx: 'i64' } });

class MoveSystem extends GameSystem {
  public override readonly name = 'MoveSystem';

  public override processTick(): void {
    each(this.world, Unit, (unit) => {
      unit.x += unit.vx;
    });
  }
}

export const MyGame = defineGame({
  id: 'my-game',
  simVersion: 'my-game-1',
  tickRate: 20,
  components: [Unit],
  commands,
  onStart(ctx) {
    ctx.world.addSystem(new MoveSystem(), { phase: 'input' });
    if (ctx.purpose !== 'fresh') return;
    const unit = ctx.world.createEntity();
    ctx.world.addComponent(unit, Unit, {
      x: FP.ToRaw(FP._0),
      vx: FP.ToRaw(FP._1),
    });
  },
  onCommand: {
    push(ctx, stamped) {
      each(ctx.world, Unit, (unit) => {
        unit.vx = stamped.command.vx;
      });
    },
  },
  checkOutcome: () => null,
});
```

`id` matches the server `gameTypes[].gameType` and the sim `gameId`.
`simVersion` changes whenever simulation results can change. `tickRate`
matches the server. `components` are registered, in that order, before
`onStart`.

`onCommand` is a function or a handler for every command name.
`defineCommands` rejects a bad payload and does not throw. `i64` is a
canonical decimal string on the wire. `checkOutcome` returns `null` while
the match is running. The first non-null result ends the match once.

Omit `save` and `defineGame` fills in the world modules (`formatVersion`
1). Pass `save: { formatVersion, handler }` when the default sections are
not enough. `onStart` receives the engine-owned world. Call `ctx.open()`
before spawning pooled entities. If `onStart` returns without calling it,
the runner does. Return a custom sim object, or return nothing and the
runner keeps `{ world }`. On `purpose: 'restore'`, spawn only what the
snapshot will overwrite or skip.

`systems` factories are added in the `late` phase, `frameSystems` in
`render`. A system that must run in another phase is added from `onStart`
with `world.addSystem(system, { phase })`.

`spawn(world, { Unit: { x: 0n } })`, `despawn(world, entity)`, and
`each(world, Unit, (row) => { ... })` are plain functions. `each` walks
rows in ascending id and reuses one view. Do not store it.

## Run it locally

```ts
const match = runLocalMatch(MyGame, {
  seed: 1,
  stepped: true,
  slots: [
    { kind: 'human', playerId: 'local' },
    { kind: 'bot', policy: 'walker' },
  ],
});
match.step(10);
```

`stepped: true` advances with `match.step()`. Omit it and a clock runs at
`tickRate`. The explicit form is the same runner:

```ts
import { LocalTransport, MatchRunner } from '@phalanx-engine/runtime';

const transport = new LocalTransport({ tickRate: MyGame.tickRate });
const runner = new MatchRunner(
  MyGame,
  {
    seed: 1,
    side: 'client',
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local' }],
  },
  transport
);
runner.start();
```

A clocked `LocalTransport` whose `tickRate` differs from the game throws.
`submit` rejects when the target tick is more than `maxAheadTicks` ahead
(default 8).

`side: 'client'` is devices only: offline with local bots, or relay
lockstep. `side: 'server'` adds the server as a peer. It runs the same
simulation headlessly, injects server-bot commands, arbitrates digests,
and serves snapshots. `side` is omitted from `configHash`, so both peers
share a hash. `runsOn` on a bot slot is independent of `side`.

## Join a server match

`@phalanx-engine/runtime/net` exports `ServerPeerTransport` and
`ServerPeerTransportOptions`:

```ts
{ client: PhalanxClient; gameId: string; sessionStore?: MatchSessionStore }
```

```ts
import { MatchRunner } from '@phalanx-engine/runtime';
import { ServerPeerTransport } from '@phalanx-engine/runtime/net';
import { PhalanxClient } from '@phalanx-engine/client';

const client = new PhalanxClient({
  serverUrl: 'http://localhost:3000',
  playerId: 'p1',
  gameId: MyGame.id,
});
await client.connect();

const transport = new ServerPeerTransport({
  client,
  gameId: MyGame.id,
});
const runner = await MatchRunner.join(MyGame, transport);
```

`MatchRunner.join(definition, transport, options?)` requires
`transport.join()`. A transport without it rejects with
`MatchRunner.join: transport does not support join()`.

A fresh join waits for `game-start`, takes its `matchConfig` with
`side: 'client'`, sends `client-ready`, and starts the runner. After a
reload, the stored session (token plus `matchConfig`) resumes the match:
`resumeMatch(token, -1)`, the latest server snapshot when there is one,
and the log after it.

Catch-up rules:

- The snapshot is restored with `trustPeerState` false. The client
  ignores `botState` and `inputCheckpoint` from the server snapshot.
  Server bot commands arrive later in the command stream.
- The log is fast-forwarded through `throughTick = currentTick - 1`.
  Empty ticks in the gap still run. `currentTick` between server ticks is
  the next tick to run.
- Batches that arrive during catch-up are held and delivered once, in
  order, after it. The runner is live once it is at most 2 ticks behind.
- A server `desync` for this player calls `requestResync()` with the same
  steps. At most one resync is in flight. A report that lands while one
  is running is dropped.
- The runner publishes digests with `submitHash` every `hashEveryTicks`
  (default `DEFAULT_HASH_EVERY_TICKS`, 60). The server compares hashes on
  those ticks.

## Replay

```ts
import { ReplayPlayer } from '@phalanx-engine/runtime';

const player = ReplayPlayer.from(MyGame, replay);
await player.fastForward(replay.lastTick);
```

`ReplayPlayer.from` never calls `decide` and has no `start` or `submit`.
Drive it with `play({ budgetMs })` or `fastForward(throughTick)`. A
final-digest mismatch throws. The replay format has no base snapshot.
`toReplay()` throws when the command log is incomplete.

## Snapshots and configHash

`saveWorld(world)` / `restoreWorld(world, bytes)` write the roster (when a
non-pooled entity exists), pools, SoA stores, the entity id counter, RNG,
then one `modules` container of registered save sections sorted by key.
`ENGINE_SNAPSHOT_FORMAT` is 3. A snapshot whose engine format is 2 is
rejected. `onEnable` runs after the bytes land and must not overwrite
saved fields.

`configHash` hashes the canonical config, then component records in
registration order, then command records in declaration order, then tick
system names when that list is non-empty. **Frame system names are not
hashed.** A client may register render and present systems a headless
server does not. An empty tick list leaves the digest unchanged. A
different tick order changes the hash. SoA fields are `i32`, `u32`, `u8`,
and `i64`. `f32` and `f64` are rejected because they are not saved.
Reserved component names: `roster`, `pools`, `entityIds`, `random`,
`broadphase`, `gas`, `SoASchema`.

`runner.snapshot()` stores bot state and the input checkpoint outside the
digest. `restore` compares component schemas with the booted world before
it applies the body. A field rename, reorder, or type change throws.
`digestBytes` is xxhash64 with seed 0.

## Local persistence

Pass `store` to keep a local match. Without it, `LocalTransport` does not
snapshot or write a log. `snapshotEveryTicks` defaults to 300 (tick 0 is
never a snapshot). `pauseWhenHidden` defaults to true. A host with no
`document` ignores the pause.

```ts
import {
  IndexedDbMatchStore,
  MatchRunner,
  runLocalMatch,
} from '@phalanx-engine/runtime';

const store = new IndexedDbMatchStore();
runLocalMatch(MyGame, { seed: 1, slots: [{ kind: 'human' }], store });

const resumed = await MatchRunner.resumeLocal(MyGame, store, matchId);
```

`MemoryMatchStore` is the in-memory twin. `resumeLocal` returns `null`
when the id is unknown. A bad newest snapshot is restored from the
previous one on a new runner. If every snapshot fails, it throws
`MatchResumeError` and does not clear the store. With no snapshot the
whole log is replayed from tick 0. IndexedDB schema version 2 keeps
`meta`, `commands`, and `snapshots` in separate stores. Pre-0.3.0 local
matches do not resume.

## Bots

A bot is a command producer for its slot, the same log as a human. It is
not a simulation system.

```ts
bots: {
  walker: () => ({
    decide: () => [{ type: 'push' as const, vx: 1n }],
  }),
},
```

`runner.setController(slot, 'human' | 'bot', { fromTick?, policy? })`
records a system command (`SYSTEM_PLAYER_ID`). The default `fromTick` is
`tick + inputDelayTicks`. `inputDelayTicks` defaults to 2. A relay or
local client rejects a `commands-batch` entry with that id. A runner with
a server peer applies it.

## Host and debug

`TickFrameManager` (`./advanced`) is the single-player
`ITickFrameProvider`. Pass it to `new GameWorld({ tickFrameProvider })`
and call `provider.start()` yourself. `GameWorld.start()` only
subscribes. `start()` on a host without `requestAnimationFrame` throws.

`attachDebug(world, options)` (package root) builds a `DebugDataProvider`
over the world. A panel is created only when `options.panel` is set, and
that requires a DOM. `TickFrameManager` and `DebugPanel` are `./advanced`.

## Server simulation hook

`createServerSim` returns the `ServerSimHook` the relay calls. The relay
never imports a game. See
[`phalanx-server`](../phalanx-server/README.md#server-simulation) for the
`Phalanx` constructor and the desync flag.

```ts
import { createServerSim } from '@phalanx-engine/runtime/server';
```

## Design docs

- [`docs/design/runtime-api.md`](../docs/design/runtime-api.md)
- [`docs/design/server-sim.md`](../docs/design/server-sim.md)
- [`docs/design/reconnect.md`](../docs/design/reconnect.md)
- [`docs/guides/runtime-game-guide.md`](../docs/guides/runtime-game-guide.md)

## Scripts

```bash
pnpm --filter @phalanx-engine/runtime build
pnpm --filter @phalanx-engine/runtime test
```

## License

MIT
