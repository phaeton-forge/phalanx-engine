# Building a game on Phalanx 0.3

This guide walks through a complete two-player game on Phalanx Engine 0.3.0.
You will define one deterministic simulation, run it offline against a bot,
save it, replay it, and then host the same simulation on a server that
plays along as a lockstep peer.

The game is a small duel. Two fighters stand on a line. A player (or a bot)
steps left or right and strikes. Health is an ability attribute. The team
that still has a fighter wins.

Every sample below is the 0.3.0 API of `@phalanx-engine/game`. The snippets
grow into one project: `src/fixed.ts`, `src/components.ts`, `src/fighter.ts`,
`src/systems.ts`, `src/combat.ts`, `src/duel.ts`, then an offline runner and
an online host. Node is 24 or newer. The packages are ESM, so local imports
use the `.js` extension even when the source file is `.ts`.

## Overview and mental model

Phalanx is a deterministic lockstep engine. Every peer that sees the same
commands and the same match seed produces the same simulation state. The
server's job in a relay match is to order those commands and broadcast
them. Engine 0.3 adds an optional second mode: the server runs the same
simulation headlessly, injects bot commands into that stream, compares
hashes, and hands a client a snapshot when it falls behind. Nobody streams
positions or health. Those live only inside the simulation.

Two types carry a game.

`defineGame` is the description. It names the components, the commands, the
systems, the bots, the win condition, and how state is saved. It does not
open a socket and it does not start a clock.

`MatchRunner` is the machine that plays that description. It owns the
world, applies commands, advances ticks, hashes state, and talks to a
transport.

| Transport             | What it is for                                                             |
| --------------------- | -------------------------------------------------------------------------- |
| `LocalTransport`      | One process. Offline play, tests, and replays. Optional local save.        |
| `ServerPeerTransport` | A client in a match whose server is also simulating. Reconnect and resync. |

`runLocalMatch` is the short way to build a runner on `LocalTransport`.
`MatchRunner.join` is the short way to build one on a network transport.

A tick is the simulation. It is deterministic: fixed-point math, the match
seed, and the command log. A frame is presentation. It may interpolate,
draw, and play sound. Frame code reads the simulation and does not write
it back.

### Where to import from

Install the facade and, for online play, the client and the server:

```bash
pnpm add @phalanx-engine/game
pnpm add @phalanx-engine/client @phalanx-engine/server
```

`@phalanx-engine/game` is the package a game imports. It re-exports the
match runtime and the entity types you use every day. The other entry
points stay separate so a server build never pulls in a renderer by
accident.

| Import                           | What lives there                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@phalanx-engine/game`           | `defineGame`, `defineCommands`, `defineComponent`, `MatchRunner`, `runLocalMatch`, `spawn`, `saveWorld`, `GameWorld`, `GameSystem` |
| `@phalanx-engine/game/math`      | `FP`, `FPVector3`, `DeterministicRandom`                                                                                           |
| `@phalanx-engine/game/physics`   | `PhysicsWorld`, `Transform`, `attachTransform`, `setVelocity`, `readFpPosition`                                                    |
| `@phalanx-engine/game/abilities` | `createAbilitySystem`, `defineAttribute`, `defineEffect`, `defineAbility`                                                          |
| `@phalanx-engine/game/net`       | `ServerPeerTransport`                                                                                                              |
| `@phalanx-engine/game/server`    | `createServerSim`                                                                                                                  |
| `@phalanx-engine/game/advanced`  | `StateHelpers`, `spawnWithId`, custom `SaveHandler`                                                                                |
| `@phalanx-engine/ecs`            | `writeSorted`, `StateWriter`, `StateReader` (snapshot codecs for object components)                                                |

`@phalanx-engine/runtime` is the same match runtime without the shorter
game names. Its subpaths are `./net`, `./server`, and `./advanced`. Prefer
`@phalanx-engine/game` in application code. `@phalanx-engine/client` is the
socket client. `@phalanx-engine/server` is the relay process. Neither of
those re-exports the runner.

## Step 1: Project setup and fixed-point math

Simulation numbers are `FixedPoint` values from `@phalanx-engine/game/math`.
The scale is five decimal places: the raw integer stored in a component is
the value times `100000`. Create them once, at module scope.
`FP.FromFloat` formats a JavaScript number through `toFixed` so every
engine agrees, and that work does not belong inside a tick.

`src/fixed.ts`:

```ts
import {
  FP,
  DeterministicRandom,
  type FixedPoint,
} from '@phalanx-engine/game/math';

/** One step along the line. Hoisted: `FromFloat` does not belong in a tick. */
export const STEP = FP.FromFloat(0.5);
export const STEP_LEFT = FP.Mul(STEP, FP.FromInt(-1));
export const STEP_RIGHT = STEP;

export const STRIKE_RANGE = FP.FromFloat(1.5);
export const STRIKE_RANGE_SQ = FP.Mul(STRIKE_RANGE, STRIKE_RANGE);

export const LEFT = { x: FP.FromInt(-4), y: FP._0, z: FP._0 };
export const RIGHT = { x: FP.FromInt(4), y: FP._0, z: FP._0 };
export const BODY_RADIUS = FP.FromFloat(0.4);

/**
 * Unit X of a non-zero offset. `FP.Div` throws when the denominator is zero,
 * so the caller checks first and keeps a fallback.
 */
export function unitX(dx: FixedPoint): FixedPoint {
  if (FP.Lte(FP.Mul(dx, dx), FP._0)) return FP._0;
  const length = FP.Sqrt(FP.Mul(dx, dx));
  return FP.Div(dx, length);
}

/** Same seed, same draws, on every machine. Use `int` / `intRange` only. */
export function rollStride(seed: number): number {
  const rng = new DeterministicRandom(seed);
  return rng.intRange(1, 3);
}
```

Arithmetic is `FP.Add`, `FP.Sub`, `FP.Mul`, and `FP.Div`. Comparison is
`FP.Eq`, `FP.Lt`, `FP.Lte`, `FP.Gt`, and `FP.Gte`. `FP.ToFloat` is for
drawing a number on screen. A float that came from `ToFloat` does not go
back into the simulation.

SoA columns of type `'i64'` store the raw bigint, not a `FixedPoint`
object. Write `FP.ToRaw(value)` and read `FP.FromRaw(raw)`.

The match runner already builds a `DeterministicRandom` from the match
seed and exposes it as `ctx.rng` in `onStart` and as `this.random` inside
a system. Draws are `int(max)` for `[0, max)` and `intRange(min, max)`
with both ends included. A bot receives its own generator, seeded from
the match seed and the slot, so a bot's draws never consume the world's
sequence. `Math.random`, `Date.now`, and `performance.now` are wall-clock
and process-local. They do not appear in simulation code.

## Step 2: Components and entities

A component is data. Behaviour lives in systems and in command handlers.
`defineComponent` builds three kinds.

**SoA.** Flat integer columns (`i32`, `u32`, `u8`, `i64`). The engine
saves every row and folds the field list into `configHash`, the digest
that rejects a client built from a different schema. `'i64'` is the column
type for every fixed-point value. Float columns are rejected here.

**Object.** A value you create, save, and load yourself. `Set` and `Map`
have no defined iteration order across engines, so `save` writes them
with `writeSorted` (string keys in UTF-16 order, safe-integer keys in
numeric order). `registerComponent` throws if `save` or `load` is missing.
Object components are saved and are not part of `configHash`.

**Transient.** Display state. It is not saved and it is not part of
`configHash`. A tick system may attach one and must not read one. A read
during a tick throws, including `entity.hasComponents`. Frame code may
read and write it. After a restore the value is gone until something
creates it again.

`src/components.ts`:

```ts
import { defineComponent } from '@phalanx-engine/game';
import {
  writeSorted,
  type StateReader,
  type StateWriter,
} from '@phalanx-engine/ecs';

/** Team id for one fighter. Health lives on the ability attribute. */
export const Unit = defineComponent(
  'Unit',
  { team: 'u8' },
  { defaults: { team: 0 } }
);

/** A non-pooled marker. `x` is a raw fixed-point bigint. */
export const Marker = defineComponent(
  'Marker',
  { x: 'i64' },
  { defaults: { x: 0n } }
);

interface InventoryState {
  items: Set<string>;
}

export const Inventory = defineComponent('Inventory', {
  kind: 'object',
  create(): InventoryState {
    return { items: new Set() };
  },
  save(value: InventoryState, writer: StateWriter): void {
    writeSorted(writer, value.items, (item, nested) => {
      nested.str(item);
    });
  },
  load(reader: StateReader): InventoryState {
    const items = new Set<string>();
    reader.list((nested) => {
      items.add(nested.str());
    });
    return { items };
  },
});

/** Render-only pulse. A tick system that reads this throws. */
export const SelectionHighlight = defineComponent('SelectionHighlight', {
  kind: 'transient',
  create: () => ({ pulse: 0 }),
});
```

`defineGame` registers the `components` array, in order, before
`onStart`. That array is the SoA components. Their order is part of
`configHash`. Object and transient components are not in that list:
register them in `onStart` with `world.registerComponent` before
anything attaches them. Register the same components, in the same
order, on every peer.

### Creating entities

`world.createEntity()` assigns an id and registers the entity.
`world.addComponent(entity, Comp, values)` attaches a component.
`world.getComponent` returns a **copy** of an SoA row and the **stored
object** for an object or transient component. Writing the SoA copy does
not write the row. `world.removeComponent` detaches one component.

`spawn` is the short form for SoA rows. The keys are component names.
`despawn` returns a pooled entity to its pool and destroys any other
entity. `each` walks one SoA store in ascending entity id and hands you
one reused view. Assigning `unit.team = 1` writes the column. Do not keep
the view, and do not read it after the callback returns.

`src/marker.ts`:

```ts
import {
  despawn,
  each,
  spawn,
  type Entity,
  type GameWorld,
} from '@phalanx-engine/game';
import { Inventory, Marker, SelectionHighlight } from './components.js';

export function placeMarker(world: GameWorld): Entity {
  const marker = spawn(world, { Marker: { x: 0n } });
  world.addComponent(marker, Inventory);
  world.addComponent(marker, SelectionHighlight);
  world.getComponent(marker, Inventory)?.items.add('banner');
  return marker;
}

export function markerX(world: GameWorld): bigint {
  let x = 0n;
  each(world, Marker, (marker) => {
    x = marker.x;
  });
  return x;
}

export function clearMarker(world: GameWorld, marker: Entity): void {
  despawn(world, marker);
}
```

`spawn` only accepts numeric and bigint fields, which is why `Inventory`
is attached with `addComponent` afterwards.

### Pools

Fighters are pooled. The factory is `(id, world) => entity`. It may call
`world.addComponent` on the dormant entity. The entity joins the world on
`pools.spawn`. Game code only calls `pools.spawn(typeKey, args)` and
`pools.despawn(entity)` (or the `despawn` helper, which does the same for
a pooled entity).

`onSpawn` writes per-life values and does not allocate. `onDespawn` clears
game-level state, allocates nothing, and is safe to call twice. Components
are attached in the constructor. SoA rows reset to the defaults from
`defineComponent` before `onSpawn`. Object and transient components are
dropped when the entity returns to the pool. `AbilityOwner` is restored
by the ability system from the shell captured on the first return, so
`onSpawn` does not rebuild attributes.

The physics and ability pieces of this class are filled in step 4. The
shape is fixed here. `src/fighter.ts`:

```ts
import {
  Entity,
  type GameWorld,
  type IPoolableEntity,
} from '@phalanx-engine/game';
import { Unit } from './components.js';

export interface FighterArgs {
  readonly team: number;
}

export class Fighter extends Entity implements IPoolableEntity<FighterArgs> {
  public constructor(id: number, world: GameWorld) {
    super(id);
    world.addComponent(this, Unit, { team: 0 });
  }

  public onSpawn(args: FighterArgs): void {
    const store = this._owner?.getSoAStore(Unit.schema);
    const row = store?.indexOf(this.id) ?? -1;
    if (store === undefined || row < 0) return;
    const team = store.arrays.team[row];
    if (team === undefined) return;
    store.arrays.team[row] = args.team;
  }

  public onDespawn(): void {
    const store = this._owner?.getSoAStore(Unit.schema);
    const row = store?.indexOf(this.id) ?? -1;
    if (store === undefined || row < 0) return;
    store.arrays.team[row] = 0;
  }
}

export const fighterPooling = {
  entityTypes: {
    fighter: {
      factory: (id: number, world: GameWorld) => new Fighter(id, world),
      pool: { initialSize: 2 },
    },
  },
  autoPrewarm: true,
};
```

`_owner` is the world that holds the row. `indexOf` is the row to write.
A missing row returns immediately. Call `ctx.open()` before the first
`pools.spawn` so the pool is prewarmed. If `pool.getStats().missCount`
is greater than zero after prewarm, raise `initialSize`.

## Step 3: Queries, services, and system phases

`world.query(Unit, Transform)` visits entities that have **every** listed
component, in ascending id. The row is `[entity, ...slots]`. A SoA slot is
the **row index** in that store. An object or transient slot is the stored
value. Read the index immediately: it is valid until the next add or
remove in that store, and a removal swaps the last row into the hole.
The row array is reused on the next step. Do not keep it. Entities created
during the pass are not visited. An entity that loses a component before
its turn is skipped.

`world.queryAny(...)` visits entities that have **at least one** of the
components. A missing slot is `undefined`.

A tick runs four phases, in this order: `input`, `physics`, `abilities`,
`late`. A frame runs `interpolation`, `render`, `present`. Inside a phase,
systems run in registration order. `before` and `after` name other systems
in that same phase and refine the order. A cycle throws when the order is
resolved. `world.start()` freezes the order; a later `addSystem` throws.

`defineGame({ systems })` constructs each factory and adds it to the
`late` phase. `frameSystems` land in `render`. A system that must run in
`input` is added from `onStart` with `world.addSystem`, **before**
`ctx.open()`. `open` starts the world.

Tick system names are part of `configHash`. The default name is the class
name, and a minifier renames classes, so a bundled multiplayer build sets
an explicit name. Both peers must register the same tick systems in the
same order. Frame names are not hashed: a client may add a render system
the headless server also registers, or the other way around, without
changing the digest. `before` / `after` still look up that string, so name
frame systems too.

`src/systems.ts`:

```ts
import { GameSystem, despawn } from '@phalanx-engine/game';
import { FP } from '@phalanx-engine/game/math';
import { Transform, writeYaw } from '@phalanx-engine/game/physics';
import { Abilities } from '@phalanx-engine/game/abilities';
import { SelectionHighlight, Unit } from './components.js';

const ids: number[] = [];
const rawX: bigint[] = [];
const teams: number[] = [];

/** Face the nearest other team. Runs in `input`, before physics. */
export class Facing extends GameSystem {
  public override readonly name = 'Facing';

  public override processTick(): void {
    ids.length = 0;
    const units = this.entityManager.getSoAStore(Unit.schema);
    const bodies = this.entityManager.getSoAStore(Transform.schema);
    if (units === undefined || bodies === undefined) return;

    for (const [entity, unitRow, transformRow] of this.world.query(
      Unit,
      Transform
    )) {
      const x = bodies.arrays.fpPositionX[transformRow];
      const team = units.arrays.team[unitRow];
      if (x === undefined || team === undefined) continue;
      ids.push(entity.id);
      rawX[ids.length - 1] = x;
      teams[ids.length - 1] = team;
    }

    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      if (id === undefined) continue;
      const entity = this.entityManager.getEntity(id);
      if (entity === undefined) continue;
      const mine = teams[i] ?? 0;
      let other: bigint | undefined;
      for (let j = 0; j < ids.length; j += 1) {
        if ((teams[j] ?? 0) !== mine) other = rawX[j];
      }
      if (other === undefined) continue;
      const self = rawX[i] ?? 0n;
      writeYaw(entity, self <= other ? FP._0 : FP.Pi);
    }
  }
}

/** `late` phase: the ability tick has already applied this tick's damage. */
export class RemoveDefeated extends GameSystem {
  public override readonly name = 'RemoveDefeated';

  public override processTick(): void {
    const abilities = this.context.getService(Abilities);
    for (const [entity] of this.world.query(Unit)) {
      const health = abilities.tryGetAttribute(entity.id, 'Health');
      if (health !== undefined && FP.Lte(health.current, FP._0)) {
        despawn(this.world, entity);
      }
    }
  }
}

/**
 * `render` phase. Reads and writes a transient component. Tick code must
 * not do this read: `getComponent` throws while a tick is running.
 */
export class HighlightPulse extends GameSystem {
  public override readonly name = 'HighlightPulse';

  public override update(): void {
    for (const [, highlight] of this.world.query(SelectionHighlight)) {
      highlight.pulse = (highlight.pulse + 1) % 60;
    }
  }
}
```

The scratch arrays live at module scope. `push` grows them on the first
fights and then reuses the storage. `rawX[i] ?? 0n` is a local read of a
bigint that was copied out of the column, so a later removal cannot make
the index point at a different fighter.

### Services

A service is a typed object the world holds for systems. Keys compare by
identity, so call `defineService` once at module scope and share that key.
`world.provide(key, impl)` stores it. `this.context.getService(key)` reads
it and throws, listing the names that were provided, when it is missing.
`tryGetService` returns `undefined` instead. Provide a service before
`addSystem` if `init` reads it. Physics and abilities each provide one
(`Physics`, `Abilities`) when you attach them in the next step.

```ts
import { defineService } from '@phalanx-engine/game';
import { STRIKE_RANGE_SQ } from './fixed.js';

export interface DuelRules {
  readonly strikeRangeSq: typeof STRIKE_RANGE_SQ;
}

export const Rules = defineService<DuelRules>('duel.rules');

export const duelRules: DuelRules = { strikeRangeSq: STRIKE_RANGE_SQ };
```

Add that block to the bottom of `src/systems.ts`. `onStart` calls
`world.provide(Rules, duelRules)`.

## Step 4: Physics and abilities

### Physics

`PhysicsWorld.attach(world)` is the whole wiring step. It registers
`Transform`, `PhysicsBody`, and the transient `Interpolation` component,
provides the `Physics` service, adds `GravitySystem` then `PhysicsSystem`
to the `physics` tick phase, adds `InterpolationSystem` to the
`interpolation` frame phase, and registers the save section
`physics.broadphase`. Call it before `ctx.open()`. A second `attach` on
the same world does nothing. A different world throws.

Two independent switches:

- `integrate: true` (the default) moves bodies by their velocity, with
  friction, a speed cap, and optional gravity on Y.
- `integrate: false` with `collisionResponse: 'push'` only separates
  overlaps. The game writes positions. The push is written into velocity
  and is not integrated into position. One resolution pass runs per tick.
  This is the duel: commands move the fighters, and physics pushes them
  apart when they occupy the same point.

`attachTransform`, `attachPhysicsBody`, `setVelocity`, and
`readFpPosition` are the helpers. `readFpPosition` returns a shared
scratch vector. Keep the `FixedPoint` you read (`.x` is a new value; the
vector itself is what the next call overwrites). A missing row returns a
zero vector and does not throw.

`BODY_RADIUS` is declared next to `STEP` in `src/fixed.ts`. The complete
`src/fighter.ts`, including `AbilityOwner`, is at the end of this step.
In `onStart`, before `ctx.open()`:

```ts
import { PhysicsWorld } from '@phalanx-engine/game/physics';

const physics = new PhysicsWorld({
  tickRate: 20,
  integrate: false,
  collisionResponse: 'push',
  gravity: FP._0,
});
physics.attach(ctx.world);
```

Set `integrate: true` (or leave it unset) and set `gravity` when bodies
should fall. Gravity is Y only. `gravityAxis: 'x'` or `'z'` throws,
because those axes belong to the position integrator. Subscribe to
`physics.onCollision` only after the world has started (`ctx.open()`).
The callback is for presentation, or for work you apply on a later tick.
`TRIGGER_ENTER` and `TRIGGER_EXIT` are reserved and are not emitted.

Full integration looks like this when you want it:

```ts
const moving = new PhysicsWorld({
  tickRate: 20,
  integrate: true,
  collisionResponse: 'impulse',
  gravity: FP.FromFloat(-9.81),
});
moving.attach(ctx.world);
```

Keep one mode per game. The duel uses push-only.

### Abilities

`createAbilitySystem(world, { definitions, hooks, cues })` registers
`AbilityOwner`, `Attributes`, `ActiveEffects`, and `GameplayTags`,
provides the `Abilities` service, adds the ability systems to the
`abilities` tick phase (activation, effect application, hooks, effect
tick, attribute aggregation, then cue dispatch and cleanup), adds cue
presentation to the `present` frame phase when `cues` is non-empty, and
registers the save section `abilities`. Both peers pass the same
`definitions`. A client-only `cues` map adds `CueDispatchSystem` to the
tick list and changes `configHash`. Pass the same map on the server, or
omit it on both. Cue factories start visuals. They do not apply effects.

Durations and periods are integer tick counts. Modifier magnitudes are
`FixedPoint`. `activateAbility` returns whether the request was **queued**.
The activation itself happens when the ability phase runs. Listen for the
activated event if you need the verdict. Do not read attribute `current`
and expect a strike from this same call to have landed yet; read it next
tick, or from a `late` system, which is why `RemoveDefeated` is in `late`.

`src/combat.ts`:

```ts
import { FP } from '@phalanx-engine/game/math';
import {
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
} from '@phalanx-engine/game/abilities';

export const HEALTH = FP.FromInt(30);
const DAMAGE = FP.FromInt(-10);

export const definitions = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: HEALTH,
      min: FP._0,
      max: HEALTH,
      clamp: 'both',
    }),
  ],
  effects: [
    defineEffect({
      id: 'Effect.Damage',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: DAMAGE }],
    }),
    defineEffect({
      id: 'Effect.StrikeCooldown',
      type: 'Duration',
      durationTicks: 8,
      tagsGranted: ['Cooldown.Ability.Strike'],
    }),
  ],
  abilities: [
    defineAbility({
      id: 'Ability.Strike',
      cooldownEffectId: 'Effect.StrikeCooldown',
      target: {
        kind: 'Entity',
        origin: { kind: 'TargetEntity', entityId: 0 },
      },
      targetEffectIds: ['Effect.Damage'],
    }),
  ],
});
```

`entityId: 0` in the definition is only the origin kind. The real target
is the `providedTarget` you pass to `activateAbility`, and that object is
snapshotted. Do not mutate it afterwards.

Grant the ability by attaching `AbilityOwner`. One call creates all four
ability components. `createAbilitySystem` must already have run, which it
has by the time the pool prewarms inside `ctx.open()`. Replace the step 2
`src/fighter.ts` with this file:

```ts
import {
  Entity,
  type GameWorld,
  type IPoolableEntity,
} from '@phalanx-engine/game';
import { FP } from '@phalanx-engine/game/math';
import { AbilityOwner } from '@phalanx-engine/game/abilities';
import {
  attachPhysicsBody,
  attachTransform,
  setVelocity,
  writeFpPosition,
} from '@phalanx-engine/game/physics';
import { HEALTH } from './combat.js';
import { Unit } from './components.js';
import { BODY_RADIUS, LEFT, RIGHT } from './fixed.js';

export interface FighterArgs {
  readonly team: number;
}

export class Fighter extends Entity implements IPoolableEntity<FighterArgs> {
  public constructor(id: number, world: GameWorld) {
    super(id);
    world.addComponent(this, Unit, { team: 0 });
    attachTransform(this, LEFT);
    attachPhysicsBody(this, {
      radius: BODY_RADIUS,
      mass: FP._1,
      restitution: FP._0,
      friction: FP._0,
      useGravity: false,
    });
    world.addComponent(this, AbilityOwner, {
      attributes: { Health: HEALTH },
      abilities: ['Ability.Strike'],
      tags: ['Team.Fighter'],
    });
  }

  public onSpawn(args: FighterArgs): void {
    const store = this._owner?.getSoAStore(Unit.schema);
    const row = store?.indexOf(this.id) ?? -1;
    if (store !== undefined && row >= 0) store.arrays.team[row] = args.team;
    writeFpPosition(this, args.team === 0 ? LEFT : RIGHT);
    setVelocity(this, FP._0, FP._0, FP._0);
  }

  public onDespawn(): void {
    const store = this._owner?.getSoAStore(Unit.schema);
    const row = store?.indexOf(this.id) ?? -1;
    if (store === undefined || row < 0) return;
    store.arrays.team[row] = 0;
  }
}

export const fighterPooling = {
  entityTypes: {
    fighter: {
      factory: (id: number, world: GameWorld) => new Fighter(id, world),
      pool: { initialSize: 2 },
    },
  },
  autoPrewarm: true,
};
```

Removing `AbilityOwner` removes all four. Removing `Attributes` while the
owner is still attached throws. Object and transient components on a
pooled entity are dropped when it returns to the pool. This fighter keeps
its saved state on SoA columns, `Transform`, `PhysicsBody`, and
`AbilityOwner`, which the ability system restores from the factory shell.

## Step 5: Commands, bots, and defineGame

Players send intent. A command is a small JSON-safe object. `defineCommands`
builds `decode` and `encode`. `decode` rejects garbage and does not throw.
`i64` fields are `bigint` in the handler and decimal strings on the wire,
so a fixed-point raw value can cross the socket. Field types are `i32`,
`u32`, `u8`, `i64`, `bool`, `entity`, and `string` (64 characters unless
you set `maxLength`).

`validate` is optional, pure, and deterministic. It may read the
simulation and must not change it. Return `null` to accept, or
`rejectCommand('reason')` to drop the command. The command stays in the
log so a replay rejects it again. A throw inside `validate` is also a
rejection.

`onCommand` is a function or a map with one handler per command type. The
map is checked when the game is defined: a missing type throws. Handlers
run inside the tick, after `(slot, seq)` order, before systems.

A bot is a player. `BotPolicy.decide(sim, tick)` runs after tick `tick`
and returns commands that execute at `tick + inputDelayTicks` (default
2). It must not mutate `sim`. `save` and `restore` persist the bot's
private plan for a local resume. That state is outside the world digest.

`runsOn` chooses the process that calls `decide`:

- `'local'` — the machine running this `MatchRunner`. Offline practice
  uses this. The bot's commands are produced on that device.
- `'server'` — only the server simulation calls `decide`. Clients apply
  the bot's commands from the log and never run the policy. A server
  match rejects a bot slot that says `'local'`.

`src/marker.ts` from step 2 places the banner. `src/duel.ts` is the game. `onStart` wires services, physics, and
abilities, adds `Facing` to `input`, then calls `ctx.open()` so the `late`
and `render` factories from this definition are registered and the pool
prewarms. The opening roster is spawned only when `purpose` is `'fresh'`.

```ts
import {
  defineCommands,
  defineGame,
  rejectCommand,
  type Entity,
  type GameWorld,
} from '@phalanx-engine/game';
import { FP } from '@phalanx-engine/game/math';
import { createAbilitySystem, Abilities } from '@phalanx-engine/game/abilities';
import {
  PhysicsWorld,
  readFpPosition,
  writeFpPosition,
} from '@phalanx-engine/game/physics';
import { STEP_LEFT, STEP_RIGHT } from './fixed.js';
import { Inventory, Marker, SelectionHighlight, Unit } from './components.js';
import { Fighter, fighterPooling } from './fighter.js';
import { placeMarker } from './marker.js';
import {
  Facing,
  HighlightPulse,
  RemoveDefeated,
  Rules,
  duelRules,
} from './systems.js';
import { definitions } from './combat.js';

const commands = defineCommands(
  {
    move: { dx: 'i64' },
    strike: {},
  },
  {
    validate(command) {
      if (command.type !== 'move') return null;
      if (command.dx === -1n || command.dx === 1n) return null;
      return rejectCommand('move dx must be -1 or 1');
    },
  }
);

function teamAt(world: GameWorld, row: number): number | undefined {
  return world.entityManager.getSoAStore(Unit.schema)?.arrays.team[row];
}

/** This duel sets `team` equal to the slot index. */
function fighterForSlot(world: GameWorld, slot: number): Entity | undefined {
  for (const [entity, row] of world.query(Unit)) {
    if (teamAt(world, row) === slot) return entity;
  }
  return undefined;
}

function opponentOf(world: GameWorld, self: Entity): Entity | undefined {
  const units = world.entityManager.getSoAStore(Unit.schema);
  const selfRow = units?.indexOf(self.id) ?? -1;
  const mine = selfRow < 0 ? undefined : teamAt(world, selfRow);
  for (const [entity, row] of world.query(Unit)) {
    if (entity.id !== self.id && teamAt(world, row) !== mine) return entity;
  }
  return undefined;
}

function inRange(world: GameWorld, left: Entity, right: Entity): boolean {
  const ax = readFpPosition(left).x;
  const bx = readFpPosition(right).x;
  const dx = FP.Sub(ax, bx);
  return FP.Lte(FP.Mul(dx, dx), world.context.getService(Rules).strikeRangeSq);
}

export const Duel = defineGame({
  id: 'duel',
  simVersion: '1',
  tickRate: 20,
  components: [Unit, Marker],
  systems: [() => new RemoveDefeated()],
  frameSystems: [() => new HighlightPulse()],
  pooling: fighterPooling,
  commands,
  onStart(ctx) {
    ctx.world.registerComponent(Inventory);
    ctx.world.registerComponent(SelectionHighlight);
    ctx.world.provide(Rules, duelRules);
    new PhysicsWorld({
      tickRate: 20,
      integrate: false,
      collisionResponse: 'push',
      gravity: FP._0,
    }).attach(ctx.world);
    createAbilitySystem(ctx.world, { definitions });
    ctx.world.addSystem(new Facing(), { phase: 'input' });
    ctx.open();
    if (ctx.purpose !== 'fresh') return;
    const pools = ctx.world.pools;
    if (pools === null) throw new Error('duel: fighter pool missing');
    for (const slot of ctx.slots) {
      pools.spawn<Fighter>('fighter', { team: slot.team });
    }
    placeMarker(ctx.world);
  },
  onCommand: {
    move(ctx, stamped) {
      const fighter = fighterForSlot(ctx.world, stamped.slot);
      if (fighter === undefined) return;
      const x = readFpPosition(fighter).x;
      writeFpPosition(fighter, {
        x: FP.Add(x, stamped.command.dx < 0n ? STEP_LEFT : STEP_RIGHT),
        y: FP._0,
        z: FP._0,
      });
    },
    strike(ctx, stamped) {
      const fighter = fighterForSlot(ctx.world, stamped.slot);
      if (fighter === undefined) return;
      const target = opponentOf(ctx.world, fighter);
      if (target === undefined || !inRange(ctx.world, fighter, target)) return;
      ctx.world.context
        .getService(Abilities)
        .activateAbility(fighter.id, 'Ability.Strike', {
          entityId: target.id,
        });
    },
  },
  bots: {
    rival(_config, _slot, rng) {
      let steps = 0;
      return {
        decide() {
          steps += 1;
          if (rng.int(5) === 0) return [{ type: 'strike' as const }];
          const dx = rng.int(2) === 0 ? -1n : 1n;
          return [{ type: 'move' as const, dx }];
        },
        save(writer) {
          writer.u32(steps);
        },
        restore(reader) {
          steps = reader.u32();
        },
      };
    },
  },
  checkOutcome(sim) {
    let team0 = 0;
    let team1 = 0;
    for (const [, row] of sim.world.query(Unit)) {
      const team = teamAt(sim.world, row);
      if (team === 0) team0 += 1;
      else if (team === 1) team1 += 1;
    }
    if (team0 > 0 && team1 > 0) return null;
    if (team0 === 0 && team1 === 0) {
      return { kind: 'draw', reason: 'both-down' };
    }
    if (team0 === 0)
      return { kind: 'win', winnerTeam: 1, reason: 'eliminated' };
    return { kind: 'win', winnerTeam: 0, reason: 'eliminated' };
  },
});

export default Duel;
```

`onStart` returns nothing, so the runner keeps `{ world }` as the
simulation. On `'restore'` the world still opens and the opening roster
is skipped: the snapshot already contains those entities, and spawning
them again would duplicate the roster.

`checkOutcome` runs after every tick, including after `RemoveDefeated`.
Return `null` while both teams still have a fighter. The first non-null
result ends the match.

`inputDelayTicks` defaults to 2. A command submitted during tick 4 is
applied at tick 6. Bots follow the same delay. The cooldown
(`durationTicks: 8`) is a tick count. The bot's `rng` is the per-slot
generator, not `ctx.rng`. `save` / `restore` write only that private
`steps` counter; the runner stores it outside the world digest.

## Step 6: Offline play, persistence, and replays

`runLocalMatch` expands a short slot list, builds a `LocalTransport`,
starts the runner, and returns `{ runner, transport, step }`. `stepped:
true` leaves the clock in your hands, which is what tests want. Omit it
and the transport runs at `tickRate`.

```ts
import { runLocalMatch } from '@phalanx-engine/game';
import { Duel } from './duel.js';

const match = runLocalMatch(Duel, {
  seed: 1,
  stepped: true,
  slots: [
    { kind: 'human', team: 0 },
    { kind: 'bot', policy: 'rival', team: 1, runsOn: 'local' },
  ],
});

match.runner.submit({ type: 'move', dx: 1n });
match.step(8);
console.log(match.runner.tick, match.runner.digest());
```

Slot 0 is the human. `submit` without a slot uses the runner's local
human slot. The move is applied two ticks later. `step(8)` is enough to
see it, plus the bot's own delayed commands.

The same call with a clock, for a local window:

```ts
import { MatchRunner, LocalTransport } from '@phalanx-engine/game';
import { Duel } from './duel.js';

const runner = new MatchRunner(
  Duel,
  {
    matchId: 'local-1',
    gameId: Duel.id,
    simVersion: Duel.simVersion,
    seed: 1,
    side: 'client',
    inputDelayTicks: 2,
    slots: [
      { slot: 0, team: 0, kind: 'human', playerId: 'local:0' },
      {
        slot: 1,
        team: 1,
        kind: 'bot',
        policy: 'rival',
        level: 0,
        runsOn: 'local',
      },
    ],
  },
  new LocalTransport({ tickRate: Duel.tickRate })
);
runner.start();
```

`side: 'client'` hosts `runsOn: 'local'` bots. `side: 'server'` hosts
`runsOn: 'server'` bots. `runsOn` does not have to equal `side`; a client
runner simply does not execute a server bot.

### Local saves

Persistence is off until you pass a store. `MemoryMatchStore` keeps the
journal in memory. `IndexedDbMatchStore` uses `globalThis.indexedDB` when
a method runs, so the package itself stays free of DOM types. The default
interval is 300 completed ticks. Tick 0 is not a snapshot. The page hides
and the transport pauses a started clock; a headless process with no
document ignores that flag.

```ts
import {
  IndexedDbMatchStore,
  MatchRunner,
  MemoryMatchStore,
  runLocalMatch,
} from '@phalanx-engine/game';
import { Duel } from './duel.js';

const store = new MemoryMatchStore();
const match = runLocalMatch(Duel, {
  seed: 1,
  stepped: true,
  matchId: 'practice-1',
  store,
  snapshotEveryTicks: 30,
  slots: [
    { kind: 'human', team: 0 },
    { kind: 'bot', policy: 'rival', team: 1, runsOn: 'local' },
  ],
});
match.step(40);
await match.runner.whenPersisted();

const resumed = await MatchRunner.resumeLocal(Duel, store, 'practice-1');
if (resumed !== null) {
  resumed.start();
}
```

`resumeLocal` restores the newest snapshot whose game id, sim version,
and match id agree, then plays the command tail. It does not start the
clock; call `start()` for a live transport. A stepped resume is advanced
by the transport you configured in `options`, or you keep calling the
runner's tick path through that transport. A corrupt newest snapshot
falls back to the previous one. If every snapshot fails, `resumeLocal`
throws and leaves the store in place.

In a browser, `new IndexedDbMatchStore()` is the same interface. Pass
`{ databaseName: 'duel-matches' }` when you want a private database.

### Replays

`runner.toReplay()` copies the config, the command log, and the digest at
the last completed tick. It throws if the log was truncated by a restore
that did not keep history. `ReplayPlayer.from` plays that record and does
not run bots: their commands are already in the log. It has no `start` and
no `submit`.

```ts
import { ReplayPlayer } from '@phalanx-engine/game';
import { Duel } from './duel.js';

const replay = match.runner.toReplay();
const player = ReplayPlayer.from(Duel, replay);
await player.fastForward(replay.lastTick);
if (player.digest() !== replay.finalDigest) {
  throw new Error('replay diverged');
}
```

`play({ budgetMs })` yields to the event loop between slices.
`fastForward` runs in one slice. A digest mismatch throws.

## Step 7: Online play with a server simulation

Online play uses the same `Duel` definition. The server process loads it
in a worker. The client joins with `ServerPeerTransport` and simulates
locally from the command stream. When the client's hash disagrees with
the server, the server tells that client and the transport fetches a
fresh snapshot. The match continues.

### Server

`createServerSim` from `@phalanx-engine/game/server` returns the hook the
relay calls. The relay never imports your game. The worker imports the
module path you give it. `export` defaults to `default`, so the game
module ends with `export default Duel`.

`src/server.ts`:

```ts
import { Phalanx } from '@phalanx-engine/server';
import { createServerSim } from '@phalanx-engine/game/server';

const secret = process.env.SESSION_SECRET;
if (secret === undefined || secret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters');
}

const server = new Phalanx({
  port: 3000,
  tickRate: 20,
  gameTypes: [{ gameType: 'duel', tickRate: 20, tickMode: 'continuous' }],
  session: { secret },
  sim: createServerSim({
    games: [{ module: './dist/duel.js', configKeys: [] }],
    snapshotEveryTicks: 1000,
  }),
});

await server.start();
```

`tickRate` on the game, on `Phalanx`, and on `gameTypes` is one number.
A mismatch throws at startup. `tickMode` is `'continuous'`.
`snapshotEveryTicks` defaults to 1000. Omit `sim` and the process is a
pure relay: no worker, no server bots, and a hash mismatch ends the match.

`configKeys` lists extra integer fields a room may put on `matchConfig`
(a map id, a round limit). Anything else is rejected. The engine fills
`seed`, `side`, and `matchId` itself.

For tests, `createServerSim({ mode: 'inProcess', games: [Duel] })` runs
the definition in the server process instead of a worker.

### Opening a server match

A server match is a private room whose `room-create` includes
`matchConfig`. `PhalanxClient.createRoom(gameType)` does not send that
field; it opens a two-human relay room. The server accepts the payload
below on `room-create`. The engine's client tests emit it on the socket
`connect()` already opened, because the helper has no parameter for it:

```ts
import { PhalanxClient } from '@phalanx-engine/client';

export function openPracticeRoom(
  client: PhalanxClient,
  playerId: string
): void {
  const socket = (
    client as unknown as {
      socketManager: { socket: { emit(event: string, body: unknown): void } };
    }
  ).socketManager.socket;
  socket.emit('room-create', {
    playerId,
    username: playerId,
    gameType: 'duel',
    matchConfig: {
      gameId: 'duel',
      simMode: 'server',
      slots: [
        { slot: 0, team: 0, kind: 'human', playerId },
        {
          slot: 1,
          team: 1,
          kind: 'bot',
          policy: 'rival',
          level: 0,
          runsOn: 'server',
        },
      ],
    },
  });
}
```

A single human plus a server bot starts the match immediately. Two human
slots produce a room code; the second player sends `room-join` with that
code, and `client.joinRoom(code)` does that. The creating player must
occupy a human slot. Bot player ids are assigned by the server
(`bot:<slot>`). Do not invent them on the client.

### Client

`src/client.ts`:

```ts
import { PhalanxClient } from '@phalanx-engine/client';
import { MatchRunner } from '@phalanx-engine/game';
import { ServerPeerTransport } from '@phalanx-engine/game/net';
import { Duel } from './duel.js';
import { openPracticeRoom } from './room.js';

const playerId = 'player-a';
const client = new PhalanxClient({
  serverUrl: 'http://localhost:3000',
  playerId,
  gameId: Duel.id,
  tickRate: Duel.tickRate,
});

await client.connect();
const transport = new ServerPeerTransport({ client, gameId: Duel.id });
// Start join before room-create so game-start is not missed.
const joined = MatchRunner.join(Duel, transport);
openPracticeRoom(client, playerId);
const runner = await joined;
runner.onOutcome((outcome) => {
  console.log(outcome.kind);
});
```

`gameId` turns on `MatchSessionStore` (`localStorage` key
`phalanx.session.duel`). `ServerPeerTransport.join`, which
`MatchRunner.join` calls, does one of two things.

**Fresh match.** It waits for `game-start`. That event carries
`matchConfig`. The transport stores it on the session (the client does
the same when a session for that match already exists), rewrites `side`
to `'client'`, and calls `sendReady()`. You do not also call
`sendReady()` yourself. The runner then starts from tick 0.

**Reloaded tab.** The stored session has a token and a `matchConfig`.
`join` calls `resumeMatch(token, -1)`, then `requestMatchSnapshot()` when
the resume says a snapshot exists, then `fetchMatchLog(snapshot.tick + 1)`
for the commands after that snapshot. The runner restores the snapshot
(ignoring the snapshot's bot bytes and input checkpoint; those belong to
the hosting side) and fast-forwards through `currentTick - 1`. Live
batches that arrive during the catch-up are delivered once, in order,
afterwards.

A later `session-token` updates the token. When the token is for the
same match, the stored `matchConfig` is kept. When it is a new match, the
config from that match's `game-start` is what gets stored. `match-end`
clears the session. Set `session.secret` on the server or no token is
issued and a killed tab cannot resume.

### Desync

Every 60 ticks the server publishes its digest. Each client is compared
with the server, not with the other clients. The first mismatch emits
`desync` to that player only. The client's event is `serverDesync`, with
`ServerDesyncEvent` `{ playerId, tick }`. The match does not end.

`MatchRunner.join` subscribes to that event. For the local player it
calls `requestResync`: hold live batches, `requestMatchSnapshot()`, fetch
the log from `snapshot.tick + 1`, restore, and fast-forward. One resync
runs at a time. After the snapshot is delivered, the server clears that
player's "already reported" flag, so a later divergence is reported
again instead of being swallowed.

You can listen yourself for a UI toast. The transport still performs the
resync:

```ts
import type { ServerDesyncEvent } from '@phalanx-engine/client';

client.on('serverDesync', (event: ServerDesyncEvent) => {
  console.warn(`server digest disagreed at tick ${event.tick}`);
});
```

`client.requestMatchSnapshot()` returns `{ tick, bytes, requestId }`.
Callers that share the server's one-second answer window share one
reply. It rejects when the socket is down or the match has ended. Prefer
letting `ServerPeerTransport` call it.

A relay match with no `sim` is a different event (`desync`) and ends the
match. Do not handle the two the same way.

## Step 8: Testing and the determinism checklist

Drive tests with `runLocalMatch(..., { stepped: true })`. Do not call
`world.start()` yourself in a unit test; the runner does. Do not call
`world.processAllTicks` on a world the runner owns. Compare fixed-point
results with `FP.Eq` / `FP.Lte`. `toBeCloseTo` is for a float you already
converted with `FP.ToFloat` for the screen.

**Snapshot round-trip.** Save the world, restore into a second fresh
match, save again. The bytes match.

```ts
import { describe, expect, it } from 'vitest';
import { runLocalMatch, saveWorld, restoreWorld } from '@phalanx-engine/game';
import { FP } from '@phalanx-engine/game/math';
import { Duel } from './duel.js';

const slots = [
  { kind: 'human' as const, team: 0 },
  { kind: 'bot' as const, policy: 'rival', team: 1, runsOn: 'local' as const },
];

describe('duel', () => {
  it('round-trips a snapshot', () => {
    const source = runLocalMatch(Duel, { seed: 7, stepped: true, slots });
    source.step(12);
    const bytes = saveWorld(source.runner.sim.world);

    const target = runLocalMatch(Duel, { seed: 7, stepped: true, slots });
    restoreWorld(target.runner.sim.world, bytes);
    expect(saveWorld(target.runner.sim.world)).toEqual(bytes);
    source.runner.dispose();
    target.runner.dispose();
  });

  it('repeats the digest for one seed and changes it for another', () => {
    const play = (seed: number) => {
      const match = runLocalMatch(Duel, { seed, stepped: true, slots });
      match.runner.submit({ type: 'strike' });
      match.step(20);
      const digest = match.runner.digest();
      match.runner.dispose();
      return digest;
    };
    expect(play(1)).toBe(play(1));
    expect(play(1)).not.toBe(play(2));
  });
});
```

**Determinism.** Two runs with the same seed, the same slots, and the
same submits produce the same `digest()` at the same tick. That is the
test you keep. A third run that changes one command, one seed, or one
system order must produce a different digest. That third run is the
mutant: it is the same program with one deliberate change, and the
assertion is that the change is visible. If a mutant of the strike
magnitude still hashes the same, the outcome is not actually reading that
value.

**Continuation.** Restore a snapshot, step the same commands the original
steps, and compare digests tick by tick. A restored bot with a log tail
keeps calling `decide` and only submits commands whose target tick is
past the tail. `rivalPolicy.save` / `restore` is what makes that decision
match a match that never paused.

Checklist for anything you add under `processTick` or `onCommand`:

1. Fixed-point math, module-scope `FP.FromFloat` / `FP.FromInt`, raw
   bigint in `'i64'` columns.
2. No `Math.random`, no `Date.now`, no `performance.now`. Randomness is
   `this.random` or the bot's `rng`, and only `int` / `intRange`.
3. Entity loops walk `entityIds()`, `world.query`, or `each`, in id
   order. Unordered `Map` / `Set` iteration does not decide simulation
   results. `writeSorted` is how a `Set` gets into a save.
4. No `store.get(id)` in the loop. Hoist column arrays. A query index is
   used before the next add or remove in that store.
5. Tick code does not read transient components and does not touch the
   DOM, the renderer, or assets.
6. Every division checks the denominator. `FP.Div` throws on zero.
7. The tick system has `public override readonly name = '...'`.
8. Both peers register the same components, the same tick systems, and
   the same ability definitions before the first spawn.
9. A pooled type has a spawn, despawn, respawn test. Attributes and tags
   from the factory come back. Per-life fields written in `onSpawn` do
   not leak into the next life.

`HighlightPulse.update` is the place for `pulse`. It is not in the
checklist above because it is a frame system.

## Advanced

The default save handler is the world modules: `saveWorld` /
`restoreWorld`, used automatically when `defineGame` omits `save`. That
is the right handler for the duel. You need something else in two cases.

**A simulation singleton that is not an entity** (the next wave index, a
match timer that is not a component). `bindWorldSingletons` appends
sections after the engine sections. The default handler still runs.

```ts
import { bindWorldSingletons } from '@phalanx-engine/game';

let nextWaveTick = 0;

bindWorldSingletons(world, {
  onSave(writer) {
    writer.section('waves', 1, (section) => {
      section.u32(nextWaveTick);
    });
  },
  onRestore(reader) {
    nextWaveTick = reader.section('waves', (section) => section.u32());
  },
});
```

Call this during `onStart`, for both `'fresh'` and `'restore'`, before
the world is saved. `onSave` and `onRestore` must describe the same
sections.

**A byte layout you own completely.** Pass `save` to `defineGame`. The
world modules are no longer installed for you. Build them with
`StateHelpers` from `@phalanx-engine/game/advanced`, in this order, on
both sides:

1. `spawnWithId` for dynamic entities that are not in a pool.
2. `readPools` (and `writePools` on the way out).
3. `readSoAStores` / `writeSoAStores`.
4. `readEntityIds` / `writeEntityIds`.
5. `readRandom` / `writeRandom`.
6. `readModuleSections` / `writeModuleSections` for `abilities`,
   `physics.broadphase`, and any section a package registered.

`spawnWithId` throws if that id is already registered. `restoreWorld`
skips an id the fresh world already created and overwrites its rows,
which is why a custom handler that spawns the opening roster again during
`'restore'` has to use the ids from the save rather than `createEntity`.

```ts
import type { GameWorld } from '@phalanx-engine/game';
import { StateHelpers, type SaveHandler } from '@phalanx-engine/game/advanced';
import { Transform } from '@phalanx-engine/game/physics';
import { Marker, Unit } from './components.js';

const SCHEMAS = [Unit.schema, Marker.schema, Transform.schema];

export function duelSave(sim: { world: GameWorld }): SaveHandler {
  return {
    save(writer) {
      StateHelpers.writePools(writer, sim.world);
      StateHelpers.writeSoAStores(writer, sim.world, SCHEMAS);
      StateHelpers.writeEntityIds(writer, sim.world);
      StateHelpers.writeRandom(writer, sim.world.random);
      StateHelpers.writeModuleSections(writer, sim.world);
    },
    restore(reader) {
      StateHelpers.readPools(reader, sim.world);
      StateHelpers.readSoAStores(reader, sim.world, SCHEMAS);
      StateHelpers.readEntityIds(reader, sim.world);
      StateHelpers.readRandom(reader, sim.world.random);
      StateHelpers.readModuleSections(reader, sim.world);
    },
  };
}
```

`PhysicsBody` belongs in `SCHEMAS` too once bodies exist. The marker is
not pooled, so a complete handler also calls `spawnWithId` for it before
`readPools`. The list and the call order are the handler's contract, the
same on every peer. This sample is why the duel stays on the default
handler. `saveWorld` already walks every registered SoA store, the pools,
the id counter, the match RNG, and the module sections.

```ts
defineGame({
  // ...the rest of Duel
  save: { formatVersion: 1, handler: duelSave },
});
```

Stay on the default handler until a singleton or a layout change forces
you off it. `formatVersion` starts at 1. Bump it when the section order
changes, and add `migrate[v]` for the step from version `v` to `v + 1`.

`@phalanx-engine/game/advanced` also exports `TickFrameManager` and the
debug panel. Those are host tools. The duel does not need them: the
runner is the world's tick source, and `attachDebug` from the game
package is the optional overlay.
