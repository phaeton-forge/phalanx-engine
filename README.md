# Phalanx Engine

[![npm @phalanx-engine/game](https://img.shields.io/npm/v/@phalanx-engine/game)](https://www.npmjs.com/package/@phalanx-engine/game)
[![npm @phalanx-engine/server](https://img.shields.io/npm/v/@phalanx-engine/server)](https://www.npmjs.com/package/@phalanx-engine/server)
[![npm @phalanx-engine/client](https://img.shields.io/npm/v/@phalanx-engine/client)](https://www.npmjs.com/package/@phalanx-engine/client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license)

**Phalanx Engine 0.3.0** is a deterministic lockstep engine for TypeScript.
It is built for RTS, autobattlers, tactics, MOBAs, and turn-based games:
every peer that replays the same commands arrives at the same world.

## Why Phalanx?

You describe the simulation once, with `defineGame`. That module is the
game. Nothing in it changes when you move from a browser tab, to a
replay, to an online match whose server runs the same code.

- **One simulation, three ways to run it.** Offline against local bots
  (`LocalTransport`), a deterministic replay (`ReplayPlayer`), or online
  with the server as a lockstep peer (`ServerPeerTransport` +
  `createServerSim`). Positions and health never cross the wire. Commands
  do.
- **The same result on every CPU.** Fixed-point math
  (`@phalanx-engine/math`), typed structure-of-arrays storage and
  snapshotted object components (`@phalanx-engine/ecs`), a fixed system
  pipeline (`input → physics → abilities → late`), deterministic physics
  (`@phalanx-engine/physics`), and a gameplay-ability system in the spirit
  of Unreal GAS (`@phalanx-engine/abilities`).
- **Reconnect without a rewind argument.** Binary snapshots
  (`saveWorld` / `restoreWorld`) and xxhash64 state digests. In a
  server-simulation match a diverging client is restored from the
  server's snapshot and the match continues.
- **Install only what you need.** A relay for a simulation you already
  own is `@phalanx-engine/client` and `@phalanx-engine/server`. ECS,
  physics, and abilities stay out of `node_modules`.

## Install

Node.js `>= 24.0.0 < 25.0.0`. pnpm is the package manager this repo uses;
npm works for the published packages.

**Full engine game (recommended).** Simulation, client, and server:

```bash
pnpm add @phalanx-engine/game @phalanx-engine/client @phalanx-engine/server
```

**Offline, single-player, or a prototype.** The facade is enough:

```bash
pnpm add @phalanx-engine/game
```

**Relay-only networking.** Bring your own simulation. No ECS and no
physics are installed:

```bash
pnpm add @phalanx-engine/client @phalanx-engine/server
```

## Quick start

Sixty lines, from a local match to an authoritative server. The game
module is the same in every block. Save it as `pushGame.ts` and, for the
server worker, as `pushGame.js` after you compile it (`export default`).

```ts
import {
  defineCommands,
  defineComponent,
  defineGame,
  each,
  GameSystem,
} from '@phalanx-engine/game';
import { FP } from '@phalanx-engine/game/math';

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

export const PushGame = defineGame({
  id: 'push',
  simVersion: 'push-1',
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

export default PushGame;
```

Run that module locally. Keep `runLocalMatch` out of the file the server
worker imports.

```ts
import { runLocalMatch } from '@phalanx-engine/game';
import { PushGame } from './pushGame.js';

const match = runLocalMatch(PushGame, {
  seed: 1,
  stepped: true,
  slots: [{ kind: 'human', playerId: 'local' }],
});
match.step(20);
```

The same local match, written out:

```ts
import { LocalTransport, MatchRunner } from '@phalanx-engine/game';
import { PushGame } from './pushGame.js';

const transport = new LocalTransport({ tickRate: PushGame.tickRate });
const runner = new MatchRunner(
  PushGame,
  {
    seed: 1,
    side: 'client',
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local' }],
  },
  transport
);
runner.start();
```

The transport tick rate has to match `defineGame`'s `tickRate`. A clocked
`LocalTransport` that disagrees throws.

`name = 'MoveSystem'` is part of the match hash. A minifier can rename a
class; it cannot rename that string. Tick system names are hashed. Frame
system names are not, so a client may render systems a headless server
never registers.

Step the same module online. The server simulates; it does not stream
state.

```ts
import { Phalanx } from '@phalanx-engine/server';
import { createServerSim } from '@phalanx-engine/game/server';

new Phalanx({
  port: 3000,
  tickRate: 20,
  gameTypes: [{ gameType: 'push', tickRate: 20 }],
  sim: createServerSim({
    games: [{ module: './pushGame.js' }],
  }),
});
```

The client joins that match. `ServerPeerTransport` waits for `game-start`
of a server-simulation room (`room-create` with
`matchConfig.simMode: 'server'` and `gameId: 'push'`).

```ts
import { MatchRunner } from '@phalanx-engine/game';
import { ServerPeerTransport } from '@phalanx-engine/game/net';
import { PhalanxClient } from '@phalanx-engine/client';

const client = new PhalanxClient({
  serverUrl: 'http://localhost:3000',
  gameId: 'push',
});
await client.connect();

const runner = await MatchRunner.join(
  PushGame,
  new ServerPeerTransport({ client, gameId: 'push' })
);
```

`runner.submit({ type: 'push', vx: 1n })` sends intent. The server stamps
it, every peer applies it, and `MoveSystem` integrates `x`. A reload
resumes from the stored session. A hash mismatch restores the client from
the server snapshot and the match keeps going.

The longer walkthrough is
[`docs/guides/runtime-game-guide.md`](./docs/guides/runtime-game-guide.md).
[`abilities-playground`](./abilities-playground) is a local multiplayer
sandbox (client on port 5173, server on 3001) that runs ECS, physics, and
abilities together:

```bash
git clone https://github.com/phaeton-forge/phalanx-engine.git
cd phalanx-engine
pnpm install
pnpm build
pnpm --filter abilities-playground dev:all
```

## Architecture

Dependencies point inward. A domain package never imports the network.
The relay never imports a game.

```
composition        @phalanx-engine/game
                   one install, seven subpaths
                        │
infrastructure     client    server    runtime/net    runtime/server
                        │         │
application        @phalanx-engine/runtime
                   defineGame · MatchRunner · snapshots
                        │
contracts          @phalanx-engine/protocol
                   socket payloads, no engine types
                        │
domain             math → ecs → physics
                            └→ abilities
```

| Package                                                      | Layer          | What it is for                                                                                         |
| ------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------ |
| [`@phalanx-engine/math`](./phalanx-math/README.md)           | domain         | Fixed-point numbers, vectors, quaternions, match RNG                                                   |
| [`@phalanx-engine/ecs`](./phalanx-ecs/README.md)             | domain         | Worlds, entities, components, phased systems, pools                                                    |
| [`@phalanx-engine/physics`](./phalanx-physics/README.md)     | domain         | Deterministic bodies, gravity, collisions, interpolation                                               |
| [`@phalanx-engine/abilities`](./phalanx-abilities/README.md) | domain         | Attributes, effects, tags, abilities, cues                                                             |
| [`@phalanx-engine/protocol`](./phalanx-protocol/README.md)   | contracts      | Wire types shared by the client and the server                                                         |
| [`@phalanx-engine/runtime`](./phalanx-runtime/README.md)     | application    | `defineGame`, the match runner, snapshots, replays. `./net` and `./server` are infrastructure adapters |
| [`@phalanx-engine/client`](./phalanx-client/README.md)       | infrastructure | Browser and Node client: rooms, ticks, commands, resume                                                |
| [`@phalanx-engine/server`](./phalanx-server/README.md)       | infrastructure | Matchmaking, rooms, the tick clock, optional server simulation                                         |
| [`@phalanx-engine/game`](./phalanx-game/README.md)           | composition    | The import games should use. Re-exports the packages above                                             |

`@phalanx-engine/game` is the front door. Reach for a single package when
you want a thinner install, or when you are extending the engine itself.

## Contributing

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

Issues and pull requests:
[github.com/phaeton-forge/phalanx-engine](https://github.com/phaeton-forge/phalanx-engine).

## License

MIT
