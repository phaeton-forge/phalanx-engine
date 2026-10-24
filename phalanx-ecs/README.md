# @phalanx-engine/ecs

The world model for Phalanx. Entities are ids, components are data, and
systems run in a fixed order so two machines that see the same commands
build the same world. There is no renderer here. Bring Babylon, Three,
or a canvas.

```bash
pnpm add @phalanx-engine/ecs
```

A game usually imports these names from `@phalanx-engine/game`. The
single-player clock, `TickFrameManager`, lives in
`@phalanx-engine/runtime/advanced`. `PhalanxClient` is a clock too.

## Create a world

`tickFrameProvider` is required. `GameWorld` subscribes in `start()` and
unsubscribes in `stop()`. It does not start the provider.

```ts
import {
  Entity,
  GameSystem,
  GameWorld,
  type IPoolableEntity,
} from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import { TickFrameManager } from '@phalanx-engine/runtime/advanced';

class Projectile extends Entity implements IPoolableEntity {
  public constructor(id: number, _world: GameWorld) {
    super(id);
  }

  public onSpawn(): void {}

  public onDespawn(): void {}
}

class MoveSystem extends GameSystem {
  public override readonly name = 'MoveSystem';
  public override processTick(): void {}
}

class RenderSystem extends GameSystem {
  public override readonly name = 'RenderSystem';
  public override update(_dt: number): void {}
}

const provider = new TickFrameManager({ tickRate: 20, maxFrameTime: 0.25 });
const world = new GameWorld({
  tickFrameProvider: provider,
  random: new DeterministicRandom(1),
  pooling: {
    autoPrewarm: true,
    entityTypes: {
      projectile: {
        factory: (id, owned) => new Projectile(id, owned),
        pool: { initialSize: 32 },
      },
    },
  },
});

world.addSystem(new MoveSystem(), { phase: 'input' });
world.addSystem(new RenderSystem(), { phase: 'render' });

provider.start();
world.start({
  afterTick() {
    world.entityManager.cleanupDestroyed();
  },
});
```

Multiplayer passes the client and the match seed. Call `sendReady()`
only after the world is fully built.

```ts
import { PhalanxClient } from '@phalanx-engine/client';
import { GameWorld } from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';

await client.waitForGameStart();
const seed = client.randomSeed;
if (seed === null) throw new Error('match seed missing');

const world = new GameWorld({
  tickFrameProvider: client,
  random: new DeterministicRandom(seed),
});
world.addSystem(new MoveSystem(), { phase: 'input' });
world.start();
client.sendReady();
```

`world.random` throws when `GameWorldConfig.random` was omitted. The
provider does not carry the match RNG.

`processAllTicks` and `updateAll` are for tests. A running game lets
`start()` own the pipeline.

## Entities

Each world owns its id counter, starting at 0. Create entities after
`new GameWorld`.

```ts
const entity = world.createEntity();
const unit = world.createEntity((id) => new Unit(id));
const restored = world.createEntityWithId(5, (id) => new Unit(id));
```

Both calls register the entity. `createEntityWithId` throws
`createEntityWithId: entity N already exists` when that id is taken, and
`createEntityWithId: id must be an integer >= 1` for a bad id. A hole
does not rewind the next id.

Destroy with `entity.destroy()`, then
`entityManager.cleanupDestroyed()` in `afterTick`, then `dispose()` the
entities that call returns. Game code does not call `entity.dispose()`
on a live entity.

Do not cache an entity reference across ticks. Query again.

## Components

`defineComponent` has three shapes. Register each one before the first
row is written. Registration order is snapshot order and part of
`configHash` for saved components.

### SoA

Integer fields only: `'i64'`, `'i32'`, `'u32'`, `'u8'`. Fixed-point
values are raw `'i64'` (`FP.ToRaw` / `FP.FromRaw`). These rows are saved.

```ts
import { defineComponent } from '@phalanx-engine/ecs';

const Velocity = defineComponent(
  'Velocity',
  { velocityX: 'i64', velocityY: 'i64', velocityZ: 'i64' },
  { defaults: { velocityX: 0n, velocityY: 0n, velocityZ: 0n } }
);
world.registerComponent(Velocity);
```

`'f32'` and `'f64'` are rejected. Display floats belong on a transient
component. Reserved names: `roster`, `pools`, `entityIds`, `random`,
`broadphase`, `gas`, `SoASchema`.

### Object

Nested data, sets, and maps. `save` and `load` are required at
`registerComponent`. `writeSorted` orders `Set` and `Map` keys (UTF-16
for strings, numeric for safe integers).

```ts
import { defineComponent, writeSorted } from '@phalanx-engine/ecs';

const Bag = defineComponent('Bag', {
  kind: 'object',
  create: () => ({ tags: new Set<string>() }),
  save(value, writer) {
    writeSorted(writer, value.tags, (tag, item) => item.str(tag));
  },
  load(reader) {
    return { tags: new Set(reader.list((item) => item.str())) };
  },
});
world.registerComponent(Bag);
```

### Transient

Display state. Any fields, including floats. Omitted from the save and
from `configHash`. A tick that reads one throws, including
`entity.hasComponents` and a query.

```ts
const Visual = defineComponent('Visual', {
  kind: 'transient',
  create: () => ({ x: 0, mesh: null as object | null }),
});
world.registerComponent(Visual);
```

`restoreWorld` drops transient components first.

### Module components

A module that saves and resets an object component itself registers it
with `ModuleComponentOptions`. The world adds no per-component save
section, and a pool return does not drop it.

```ts
world.registerComponent(Bag, {
  attach(entity, init) {
    /* replace world.addComponent */
  },
  remove(entity) {
    return true;
  },
});
```

`attach` replaces the default `world.addComponent`. `remove` replaces
the default `world.removeComponent`.

A class that implements `IComponent` (`readonly type: symbol`) still
works for a bag the snapshot does not store. New simulation data uses
`defineComponent`.

## Add, get, remove

```ts
world.addComponent(entity, Velocity, { velocityX: 1n });
world.getComponent(entity, Velocity); // a copy for SoA
world.removeComponent(entity, Velocity);

world.addComponent(entity, Bag, { tags: new Set(['Team.Red']) });
world.getComponent(entity, Bag); // the stored object
```

`addComponent` without values throws when the component is already
present. A later call with values writes those fields and leaves the
rest. A SoA `getComponent` allocates a copy. Hot loops read the store
arrays by the row index from `world.query`. An object or transient
`getComponent` returns the stored value. Reading a transient component
during a tick throws.

`addComponent` accepts an entity this world allocated that is not
registered yet (a pool factory's entity). An entity of another world
throws `belongs to another world`.

## Queries

```ts
for (const [entity, row] of world.query(Velocity)) {
  const vx = store.arrays.velocityX[row];
  if (vx === undefined) continue;
  store.arrays.velocityX[row] = vx + 1n;
}

for (const [entity, row, bag] of world.query(Velocity, Bag)) {
  bag?.tags;
}

for (const [entity, attributes, effects] of world.queryAny(
  Attributes,
  ActiveEffects
)) {
  // a missing component is undefined
}
```

- Entities come in ascending id.
- The id list is taken when the loop starts. An entity removed before
  its turn is skipped. Entities created during the loop wait for the
  next pass.
- The row array is reused. Do not keep it.
- A SoA slot is the row index. An object or transient slot is the value.
- A row index is valid until the next add or remove in that store.
- An empty component list throws.
- A component widened to `QueryComponent` types its slot as
  `number | object`.

`EntityManager.queryEntities(...symbols)` remains for code that still
uses symbol keys. Game systems use `world.query` and `world.queryAny`.

## Services

A service is a per-world object found by a typed key. Keys compare by
reference. The name is for errors.

```ts
import {
  defineService,
  GameSystem,
  GameWorld,
  type ITickFrameProvider,
} from '@phalanx-engine/ecs';

interface ClockService {
  tick: number;
}
export const Clock = defineService<ClockService>('clock');

const tickFrameProvider: ITickFrameProvider = {
  onTick: () => () => {},
  onFrame: () => () => {},
};
const world = new GameWorld({ tickFrameProvider });
world.provide(Clock, { tick: 0 });

class MySystem extends GameSystem {
  public override readonly name = 'MySystem';

  public override processTick(): void {
    const clock = this.context.getService(Clock);
    clock.tick += 1;
  }
}

world.addSystem(new MySystem(), { phase: 'late' });
```

`provide` throws on a second provide of the same key, and when another
key already uses that name. `getService` throws with the missing name
and the names that are present. `tryGetService` returns `undefined`.

`PhysicsWorld.attach(world)` provides `Physics`.
`createAbilitySystem(world, ...)` provides `Abilities`.

## System phases

Tick phases, in order: `input → physics → abilities → late`
(`TICK_PHASES`).

Frame phases, in order: `interpolation → render → present`
(`FRAME_PHASES`).

`before` and `after` name other systems in the same phase. Order freezes
at `start()`. Phase order, then registration order, is execution order.
Tick names are part of `configHash`. Frame names are not.

```ts
class MoveSystem extends GameSystem {
  public override readonly name = 'MoveSystem';

  public override processTick(_tick: number): void {
    for (const [entity] of this.world.query(Unit)) {
      step(entity);
    }
  }
}

world.addSystem(new MoveSystem(), { phase: 'input' });
world.addSystem(new LandingSystem(), {
  phase: 'physics',
  after: 'PhysicsSystem',
});
world.addSystem(new RenderSystem(), { phase: 'render' });
```

Set `override readonly name`. The default is `constructor.name`, and a
bundler can rename that differently in a browser and on the server.

`processTick` is simulation. `update` is presentation and must not write
simulation state. Optional hooks are detected automatically:

```
Tick:  IBeforeTick → beforeTick → tick systems → IAfterTick → afterTick
Frame: IBeforeFrame → beforeFrame → frame systems → IAfterFrame → afterFrame
```

`init` receives `SystemContext` (`eventBus`, `entityManager`, `pools`,
`world`, services). `dispose` calls `super.dispose()` so subscriptions
from `this.subscribe` are dropped.

Systems do not call each other's `processTick`. Cross-system facts go
through the `EventBus` or `context.getSystem(X).publicMethod()`.

## Pools

The factory is `(id: number, world: GameWorld) => T`. It may call
`world.addComponent` on the dormant entity. The entity is registered on
`spawn`.

```ts
const projectile = world.pools!.spawn<Projectile>('projectile', args);
world.pools!.despawn(projectile);
```

Game code calls `spawn` and `despawn`. The engine calls `onSpawn`,
`onDespawn`, `onEnable`, `onDisable`, and `onDestroy`.

- `onCreate` runs from `addComponent`.
- Spawn: storage reset, `entity.onSpawn(args)`, `addEntity`, `onEnable`.
- Despawn: `onDisable`, `removeEntity`, `entity.onDespawn`, storage
  reset, return-to-pool hooks, release.
- `onEnable` also runs after `restoreWorld` and must not overwrite saved
  fields.

`onSpawn` and `onDespawn` allocate nothing. `onDespawn` is idempotent.
After `despawn`, the SoA rows are gone.

## Events

```ts
world.eventBus.emit('damage:applied', { targetId, amount });

class CombatSystem extends GameSystem {
  public override init(context: SystemContext): void {
    super.init(context);
    this.subscribe('damage:applied', (event) => {
      react(event);
    });
  }
}
```

Names are `namespace:verb`. Past tense for facts (`damage:applied`).
`:requested` for intents. Player intent arrives as commands. A decision
every peer can compute from state is a direct system call.

## Save sections

`StateWriter`, `StateReader`, `BinaryStateWriter`, and
`BinaryStateReader` are the snapshot codec. A module implements
`SaveSection` (`key`, `version`, `write`, `read`) and calls
`world.registerSaveSection`. Keys sort by UTF-16 code unit. The runtime
writes the registered sections.

Saving and spawning by component name are `@phalanx-engine/runtime`
functions: `saveWorld`, `restoreWorld`, `spawn`, `despawn`, `each`.

## Low-level registry

`SystemRegistry` still runs a list of systems when you are not using
`GameWorld`. New games use `addSystem` and phases.

## License

MIT
