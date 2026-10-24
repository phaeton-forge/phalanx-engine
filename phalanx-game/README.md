# @phalanx-engine/game

The package you install to write a Phalanx game. One dependency, seven
subpaths, and the simulation you describe with `defineGame` runs offline,
in a replay, or on an authoritative server without a second copy of the
rules.

Math stays on `/math`. The root does not re-export it, so a render-only
file cannot accidentally pull fixed-point into a frame.

```bash
pnpm add @phalanx-engine/game
```

Online play also wants the network packages:

```bash
pnpm add @phalanx-engine/client @phalanx-engine/server
```

`@phalanx-engine/client` is an optional peer. Only the `/net` subpath
imports it. A prototype that never leaves the machine can skip it.

The step-by-step guide is
[`docs/guides/runtime-game-guide.md`](../docs/guides/runtime-game-guide.md).
The root [README](../README.md) has a sixty-line game from local match to
server simulation.

## Subpaths

| Import                           | What you get                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@phalanx-engine/game`           | The match runtime, plus the ECS types games use: `GameWorld`, `GameSystem`, `Entity`, `defineComponent`, `defineService`, `TICK_PHASES`, `FRAME_PHASES`, `AddSystemOptions`, `TickPhase`, `FramePhase`, `SystemPhase`, `SystemOrder`                |
| `@phalanx-engine/game/math`      | `FP`, `FixedPoint`, `FPVector2`, `FPVector3`, `FPQuaternion`, `DeterministicRandom`                                                                                                                                                                 |
| `@phalanx-engine/game/physics`   | `PhysicsWorld`, `Transform`, `PhysicsBody`, `Interpolation`, and the helpers `attachTransform`, `readFpPosition`, `writeFpPosition`, `attachPhysicsBody`, `setVelocity`, `readVelocity`, `attachInterpolation`                                      |
| `@phalanx-engine/game/abilities` | `createAbilitySystem`, `defineAbilitySystem`, `defineAttribute`, `defineEffect`, `defineAbility`, `Abilities`, `AbilityOwner`, `Attributes`, `ActiveEffects`, `GameplayTags`, `abilityOwnerOf`, `attributesOf`, `activeEffectsOf`, `gameplayTagsOf` |
| `@phalanx-engine/game/net`       | `ServerPeerTransport`, `ServerPeerTransportOptions`. Needs the optional peer `@phalanx-engine/client`                                                                                                                                               |
| `@phalanx-engine/game/server`    | `createServerSim`, `ServerSimConfig`, `GameModuleSpec`, passed to `@phalanx-engine/server`                                                                                                                                                          |
| `@phalanx-engine/game/advanced`  | Low-level helpers: `StateHelpers`, `spawnWithId`, `PoolManager`, `SoAComponentStore`, `TickFrameManager`, `DebugPanel`, `Transport`, `TransportJoin`, `TransportCatchUp`, `SaveHandler`, `CommandSchema`                                            |

## Root

`defineGame`, `defineCommands`, `defineComponent`, `runLocalMatch`,
`MatchRunner`, `ReplayPlayer`, `LocalTransport`, `saveWorld`,
`restoreWorld`, `spawn`, `despawn`, and `each` live here, together with
the ECS names in the table. `MatchStore`, `MemoryMatchStore`,
`IndexedDbMatchStore`, `MatchRunner.resumeLocal`, `attachDebug`, and
`DebugDataProvider` are on the root as well.

```ts
import {
  defineComponent,
  defineCommands,
  defineGame,
  each,
  GameSystem,
  runLocalMatch,
} from '@phalanx-engine/game';
import { FP } from '@phalanx-engine/game/math';

const Unit = defineComponent('Unit', { x: 'i64', vx: 'i64' });

class MoveSystem extends GameSystem {
  public override readonly name = 'MoveSystem';

  public override processTick(): void {
    const store = this.entityManager.getOrCreateSoAStore(Unit.schema);
    const xs = store.arrays.x;
    const vxs = store.arrays.vx;
    for (const [, row] of this.world.query(Unit)) {
      const x = xs[row];
      const vx = vxs[row];
      if (x === undefined || vx === undefined) continue;
      xs[row] = x + vx;
    }
  }
}

export const MyGame = defineGame({
  id: 'my-game',
  simVersion: 'my-game-1',
  tickRate: 20,
  components: [Unit],
  commands: defineCommands({ push: { vx: 'i64' } }),
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

const match = runLocalMatch(MyGame, {
  seed: 1,
  stepped: true,
  slots: [{ kind: 'human', playerId: 'local' }],
});
match.step(1);
```

Tick system names go into `configHash`. Frame system names do not. Set
`override readonly name` on every system that can run on more than one
build of the game.

## Math

```ts
import { FP, FPVector3, DeterministicRandom } from '@phalanx-engine/game/math';

const speed = FP.FromInt(5);
const step = FP.Mul(speed, FP.FromFloat(0.05));
const origin = FPVector3.FromFloat(0, 0, 0);

const rng = new DeterministicRandom(1);
const roll = rng.intRange(1, 6);
const saved = rng.getState();
rng.setState(saved);
```

Simulation code uses `int` and `intRange`. `FP.ToFloat` is for drawing
the frame.

## Physics

`PhysicsWorld.attach(world)` registers `Transform`, `PhysicsBody`, and
transient `Interpolation`, provides the `Physics` service, and adds
gravity and the physics step to the `physics` phase.

```ts
import {
  PhysicsWorld,
  attachPhysicsBody,
  attachTransform,
} from '@phalanx-engine/game/physics';
import { FP, FPVector3 } from '@phalanx-engine/game/math';

const physics = new PhysicsWorld({ tickRate: 20 });
physics.attach(world);
attachTransform(entity, FPVector3.FromFloat(0, 0, 0));
attachPhysicsBody(entity, { radius: FP.FromFloat(0.5) });
```

`integrate: false` keeps collision response and leaves movement to the
game. `collisionResponse` is `'push'` or `'impulse'`.

## Abilities

`createAbilitySystem(world, config)` registers `AbilityOwner`,
`Attributes`, `ActiveEffects`, and `GameplayTags`, provides `Abilities`,
and runs the ability pipeline in the `abilities` phase.
`CuePresentationSystem` lands in `present`.

```ts
import {
  AbilityOwner,
  Attributes,
  abilityOwnerOf,
  attributesOf,
  createAbilitySystem,
  defineAbilitySystem,
  defineAttribute,
} from '@phalanx-engine/game/abilities';
import { FP } from '@phalanx-engine/game/math';

const definitions = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: FP.FromInt(100),
      min: FP._0,
      max: FP.FromInt(100),
      clamp: 'both',
    }),
  ],
});

const abilities = createAbilitySystem(world, { definitions });
const hero = world.createEntity();
world.addComponent(hero, AbilityOwner, {
  attributes: { Health: FP.FromInt(100) },
  abilities: [],
  tags: ['Team.Hero'],
});
world.addComponent(hero, Attributes, { Health: FP.FromInt(80) });

abilityOwnerOf(hero);
attributesOf(hero);
abilities.tryGetAttribute(hero.id, 'Health');
```

Query combatants with `world.query(ActiveEffects)` or
`world.queryAny(Attributes, ActiveEffects)`.

## Net

The client side of a server-simulation match. Install
`@phalanx-engine/client` next to this package.

```ts
import { MatchRunner } from '@phalanx-engine/game';
import { ServerPeerTransport } from '@phalanx-engine/game/net';
import { PhalanxClient } from '@phalanx-engine/client';

const client = new PhalanxClient({
  serverUrl: 'http://localhost:3000',
  gameId: MyGame.id,
});
await client.connect();

const runner = await MatchRunner.join(
  MyGame,
  new ServerPeerTransport({ client, gameId: MyGame.id })
);
```

`ServerPeerTransportOptions` is `{ client, gameId, sessionStore? }`.
`join` resumes a stored session when one exists. See the
[runtime README](../phalanx-runtime/README.md#join-a-server-match) for
catch-up and resync.

## Server

Hand this to `Phalanx`. The worker imports the compiled game module.
`export` defaults to `default`.

```ts
import { Phalanx } from '@phalanx-engine/server';
import { createServerSim } from '@phalanx-engine/game/server';

new Phalanx({
  port: 3000,
  tickRate: 20,
  gameTypes: [{ gameType: 'my-game', tickRate: 20 }],
  sim: createServerSim({
    games: [{ module: './myGame.js' }],
    mode: 'worker',
    snapshotEveryTicks: 1000,
  }),
});
```

`mode: 'inProcess'` runs the same queue on the relay thread. `workers`
accepts `1`.

## Advanced

Reach for `/advanced` when the default world snapshot is not enough, or
when a tool drives the clock by hand.

```ts
import { TickFrameManager } from '@phalanx-engine/game/advanced';
import { GameWorld } from '@phalanx-engine/game';

const provider = new TickFrameManager({ tickRate: 20, maxFrameTime: 0.25 });
const world = new GameWorld({ tickFrameProvider: provider });
provider.start();
world.start();
```

Also exported from this subpath: `StateHelpers`, `spawnWithId`,
`PoolManager`, `SoAComponentStore`, `TYPED_ARRAY_CONSTRUCTORS`,
`DebugPanel`, `DebugPanelConfig`, `TickFrameManagerConfig`, `Transport`,
`TransportKind`, `TransportJoin`, `TransportCatchUp`, `CommandEnvelope`,
`TransportCommand`, `CommandSchema`, `SaveHandler`, `SaveSpec`, and
`StateMigration`.

`InterpolatedTransformSample` is `@phalanx-engine/game/physics`.

## License

MIT
