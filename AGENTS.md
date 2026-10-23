# Phalanx Engine — Strict Coding Rules

Authoritative rules for anyone (human or AI agent) writing code in this
repository. These rules are **normative**. `MUST` / `MUST NOT` are hard
requirements — a change that violates one is a defect, even if it compiles and
the tests pass.

Scope: `phalanx-math`, `phalanx-physics`, `phalanx-ecs`, `phalanx-abilities`,
`phalanx-client`, `phalanx-server`, `abilities-playground`.

For rules that apply to games built on top of the engine, see
`../phalanx-games/AGENTS.md`.

---

## 0. The Prime Directive: Determinism

Phalanx is a **deterministic lockstep** engine. By default (relay mode) the
server never simulates the world; it only orders and rebroadcasts commands.
Every client replays the same commands and MUST arrive at bit-identical state.
Any divergence is a desync, which ends the match.

> **Amendment (runtime 0.3, opt-in server simulation):** a match configured
> with `simMode: 'server'` (`@phalanx-engine/runtime`) adds the server as a
> lockstep **peer**: it runs the same simulation code headlessly, injects
> server-bot commands into the command stream, arbitrates state hashes and
> serves snapshots. It never streams state; every rule in this file applies to
> the server-side simulation unchanged. A desynced client in this mode is
> resynced from a snapshot and the match continues. Relay mode still ends the
> match on desync. See `docs/design/server-sim.md`.

Therefore: **every line of simulation code must produce identical results on
every machine, every CPU, every browser, forever.**

### 0.1 Banned in simulation code (tick path)

| Banned                                             | Use instead                                              |
| -------------------------------------------------- | -------------------------------------------------------- |
| `Math.random()`                                    | Seeded deterministic RNG from `gameStart.randomSeed`     |
| `Date.now()`, `performance.now()`, `new Date()`    | The `tick` number passed to `processTick(tick)`          |
| `Math.sin/cos/sqrt/abs/floor/...` on sim values    | `FP.Sin`, `FP.Cos`, `FP.Sqrt`, `FP.Abs`, `FP.Floor`, ... |
| `number` arithmetic (`+ - * /`) on sim values      | `FP.Add`, `FP.Sub`, `FP.Mul`, `FP.Div`                   |
| `float`/`number` for positions, velocities, masses | `FixedPoint` (`FP`, `FPVector2/3`, `FPQuaternion`)       |
| `IRandom.float`, `floatRange`, `boolean`           | `int` / `intRange` (the float draws are `@deprecated`)   |
| Unordered `Map`/`Set`/`Object.keys` iteration      | Sorted iteration (`store.entityIds()`, `keys().sort()`)  |
| `store.forEachDense()` in a tick system            | `store.entityIds()` + `store.indexOf()`                  |
| `requestAnimationFrame` / timers driving sim state | Server-driven ticks via `ITickFrameProvider`             |
| DOM / renderer / asset access                      | Frame systems only                                       |

### 0.2 The tick/frame split (non-negotiable)

- `processTick(tick)` and `beforeTick`/`afterTick` hooks: **simulation only**.
  Deterministic, fixed-point, no rendering, no wall clock, no I/O.
- `update(dt)` and `beforeFrame`/`afterFrame` hooks: **presentation only**.
  Interpolation, rendering, UI, audio, cues. **MUST NOT mutate simulation
  state.** Frame code has read-only access to simulation components.
- Anything that must be reproduced on a remote peer belongs in the tick path.
  Anything that must not affect the outcome belongs in the frame path.

### 0.3 Domain ambient globals

Domain packages compile with `"types": []` (`phalanx-math`, `phalanx-ecs`,
`phalanx-physics`, `phalanx-abilities`). ecs and physics also use
`lib: ["ES2022"]`, so DOM and Node globals are invisible. The only allowed
way to declare a global in a domain package is an ambient file that already
exists for that purpose:

- `phalanx-ecs/src/textCodec.d.ts` — `TextEncoder` and `TextDecoder` for the
  snapshot codec.
- `phalanx-abilities/src/console.d.ts` — `console.warn` and `console.error`.

No new globals in domain packages. Do not add another ambient `.d.ts`, and do
not add names to those two files, unless an architecture task says so. Clocks,
timers, and DOM stay in `@phalanx-engine/runtime`.

### 0.4 Layers

The dependency matrix lives in `scripts/layers.mjs`. Every workspace
package declares `phalanx.layer` in its `package.json`. A new package
must set that field before it is imported. Adapter subpaths (runtime
`./server`) set `phalanx.subpaths`.

```bash
pnpm lint:layers
pnpm test:layers
pnpm check:isomorphic
```

---

## 1. Toolchain, Language & Style

- Node **`>=24.0.0 <25.0.0`**. Package manager **pnpm `10.33.2`** (pinned). Never
  use `npm`/`yarn` in this workspace.
- Pure **ESM** (`"type": "module"`), TypeScript `module`/`moduleResolution`
  = `NodeNext`. **All relative imports MUST carry the `.js` extension**
  (`import { EventBus } from './EventBus.js'`).
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`,
  `noFallthroughCasesInSwitch: true`. Do not weaken these to make code compile.
- **`any` is banned** (`@typescript-eslint/no-explicit-any: error`). Use
  `unknown` plus a type guard. Casts through `as unknown as X` are a code smell
  and require a comment justifying them.
- `prefer-const` and `no-var` are errors. `no-console` is a warning; only
  `console.warn` / `console.error` are permitted — and **MUST NOT** be used to
  smuggle informational logging past the lint rule. Production engine code
  should log nothing.
- Prettier is the single source of truth for formatting: single quotes,
  semicolons, `trailingComma: es5`, `printWidth: 80`, 2 spaces, LF.
  Unused args/vars must be prefixed `_`.
- Naming: `PascalCase` for classes/interfaces/types, `camelCase` for
  variables/functions, `UPPER_SNAKE_CASE` for module constants,
  `XxxComponent` / `XxxSystem` / `XxxEntity` suffixes for ECS artifacts.
- Prefer `interface` for public, extensible API shapes; `type` for unions and
  aliases.

### 1.1 Commands

```bash
pnpm install
pnpm build          # pnpm -r build (tsc per package)
pnpm test           # pnpm -r test (vitest run)
pnpm lint           # eslint . --ext .ts,.tsx
pnpm format:check   # prettier --check
pnpm --filter @phalanx-engine/<pkg> test    # targeted
```

**Before every commit**: `pnpm build`, `pnpm test`, `pnpm lint`,
`pnpm format:check` must all pass. Prefer the narrowest targeted test filter
during iteration, then run the full suite once before finishing.

### 1.2 Versioning & publishing

- All `@phalanx-engine/*` packages are **version-locked together**. Never hand-
  edit a single package version — use `pnpm version:bump[:minor|:major]`
  (`scripts/bump-package-versions.mjs`).
- Cross-package deps inside the workspace MUST use `"workspace:*"`.
- Publishing goes through `pnpm publish:packages` only.

---

## 2. Fixed-Point Math (`@phalanx-engine/math`)

- All simulation values are `FixedPoint`. Precision is **5 decimal places**
  (`DEFAULT_PRECISION = 5`).
- Create with `FP.FromInt` / `FP.FromFloat` / `FP.FromString`. Use the shared
  constants `FP._0`, `FP._1`, `FP.Pi`, `FP.Pi2`, `FP.PiOver2` instead of
  reconstructing them.
- `FP.FromFloat` performs a `toFixed(5)` string parse. It is **expensive and
  MUST NOT be called inside a hot loop or per-entity**. Hoist FP constants to
  module scope or compute them once in `init()`/the constructor:
  ```ts
  const SEPARATION_HALF = FP.FromFloat(0.5); // module scope — correct
  const EPSILON = FP.FromFloat(0.0001);
  ```
- **`FP.Div` throws on a zero denominator.** Every division MUST be guarded:
  ```ts
  if (FP.Lte(distSq, FP.Mul(EPSILON, EPSILON))) return fallback;
  const dist = FP.Sqrt(distSq);
  const nx = FP.Div(dx, dist);
  ```
- SoA boundary: **write `FP.ToRaw(fp)`, read `FP.FromRaw(raw)`**. FP fields are
  always `'i64'` (`BigInt64Array`). Never store an FP value in a `Float64Array`.
- `FP.ToFloat` / `FPVector3.ToFloat` are **presentation-only** conversions.
  A float derived from FP MUST NOT flow back into simulation state.
- Degenerate geometric inputs (zero-length vectors, zero quaternions) return
  safe fallbacks (`FPQuaternion.Identity()`, zero vector). Preserve this
  behaviour — never return `NaN`, never throw from a math helper.
- Naming: squared quantities carry the `Sq` suffix (`distSq`, `velMagSq`);
  presentation floats carry a `Float` suffix or come straight from `ToFloat()`.

---

## 3. Physics (`@phalanx-engine/physics`)

- `PhysicsWorld` is the intended entry point. Prefer it over wiring
  `PhysicsSystem` / `GravitySystem` / `InterpolationSystem` by hand.
- **System order is fixed**: `GravitySystem` → `PhysicsSystem` → gameplay
  reaction systems (combat, health, scoring). Do not reorder.
- `gravityAxis` is `'y'` only; `'x'`/`'z'` throw by design (X/Z are owned by the
  position integrator). Do not "fix" this by removing the guard.
- `Transform` holds the **authoritative** FP position/rotation.
  Read it with `readFpPosition` / `readFpRotation` (shared scratch — copy
  immediately) or the SoA arrays. `PhysicsBody` has no display-float
  caches. Render smoothing reads `Interpolation` from `afterTick` and
  frame systems only.
- Component reads (`readFpPosition`, `readVelocity`) return **shared
  mutable scratch objects**. Destructure or copy immediately; **never retain the
  reference across a tick**. The same applies to `SpatialHashGrid`'s
  `queryPairs()` / `queryRadius()` results — they are reused internal buffers,
  already deterministically sorted; consume them before the next call and do not
  re-sort with a different comparator.
- Subscribe to `onCollision` / `onBoundsExit` **after** `world.start()`;
  subscribing earlier throws. `TRIGGER_ENTER` / `TRIGGER_EXIT` are reserved and
  not emitted — do not build features on them.
- `getInterpolatedTransform()` is only meaningful in frame systems, after
  `InterpolationSystem.beforeFrame(alpha)` has run.
- Missing SoA rows (`indexOf(entityId) === -1`) are always handled by an early
  return, never by throwing. Invalid _configuration_, by contrast, MUST throw
  from the constructor with a descriptive message.

---

## 4. ECS (`@phalanx-engine/ecs`)

### 4.1 Architecture invariants

- **Entities** are IDs plus a component bag. No game logic on the entity beyond
  `onSpawn`/`onDespawn` value assignment.
- **Components are pure data.** No behaviour, no cross-component logic, and
  **never** a manually-called `reinitialize()`/`reset()` method. The deleted
  `IResettableComponent` / `ComponentTemplate` concepts MUST NOT be
  reintroduced.
- **Systems are stateless processors.** A system MUST NOT call another system's
  `processTick`. Cross-system communication goes through the `EventBus` or an
  explicit `context.getSystem(X).publicMethod()` call.
- Every `IComponent` MUST expose `readonly type: symbol` matching its registry
  key.

### 4.2 Bootstrap order

```ts
await client.waitForGameStart(); // client.randomSeed is set
await assetManager.preloadAll();
const seed = client.randomSeed;
if (seed === null) throw new Error('match seed missing');
const world = new GameWorld({
  tickFrameProvider: client,
  random: new DeterministicRandom(seed), // @phalanx-engine/math
  componentTypes: [...],
});
physicsWorld.attach(world);             // wire services BEFORE registerSystems
const abilities = createAbilitySystem(world, { definitions });
world.registerSystems([...tickSystems], [...frameSystems]);
world.start({ beforeTick, afterTick, beforeFrame, afterFrame });
client.sendReady();
```

- `tickFrameProvider` is required. `GameWorld` subscribes in `start()` and
  unsubscribes in `stop()`. It does not start or stop the provider. The
  single-player provider is `TickFrameManager` in
  `@phalanx-engine/runtime/advanced`. The caller calls `provider.start()`.
- Debug snapshots are host code. Call `attachDebug(world, options)` from
  `@phalanx-engine/runtime`. The world does not store a debug provider.
- Each world owns its entity id counter (`EntityManager`, starting at 0).
  `GameWorld` does not reset a process-global counter. Create entities with
  `world.createEntity` or `world.createEntityWithId`. Never create entities
  before `new GameWorld(...)`.
- `PhalanxClient` owns match RNG: after `waitForGameStart()`, use
  `world.context.random` / `this.random` in tick systems.
- **Registration order IS execution order.** It is part of the determinism
  contract; changing it changes simulation results.
- Never call `world.processAllTicks()` / `world.updateAll()` manually outside
  unit tests — `world.start()` owns the pipeline.
- Lifecycle hooks (`IBeforeTick`, `IAfterTick`, `IBeforeFrame`, `IAfterFrame`)
  are auto-detected; do not wire them manually.

### 4.3 Storage: `IComponent` vs `SoAComponent`

Use `SoAComponent` when the data is hot-path, flat/numeric, high-cardinality, or
fixed-point. Use `IComponent` for complex/nested data, strings, object
references (meshes, callbacks) and render-only state.

Field types: `'i64'` (BigInt64Array) for **all** fixed-point simulation values;
`'f64'`/`'f32'` for display floats; `'i32'`/`'u32'` for ints/ids; `'u8'` for
flags.

Hot-path access pattern (mandatory in tick systems):

```ts
public override init(ctx: SystemContext): void {
  super.init(ctx);
  this.store = this.entityManager.getOrCreateSoAStore(MySchema); // cache in init()
}
public processTick(): void {
  const velX = this.store.arrays.velocityX;      // hoist arrays out of the loop
  for (const id of this.store.entityIds()) {     // sorted => deterministic
    const i = this.store.indexOf(id);
    ...
  }
}
```

- **MUST NOT** call `store.get(entityId)` in a hot loop — it allocates.
- **MUST NOT** call `store.add` / `store.remove` / `reattach` / `detach` from
  entity or system code. SoA row lifecycle is fully automatic.
- **MUST NOT** allocate objects/arrays inside `processTick()` loops.
- **MUST NOT** mutate the array returned by `entityIds()` while iterating it;
  snapshot first if the loop mutates membership.
- `SoAComponent` constructors MUST receive a **fresh object literal** as
  `initialValues`. A shared/mutable defaults object causes pooled respawns to
  drift.

### 4.3.1 `defineComponent` (ecs)

Domain code imports `defineComponent` from `@phalanx-engine/ecs`. The
runtime helper of the same name remains the SoA registration used by
`defineGame` until it is removed.

- SoA fields are `i32`, `u32`, `u8`, `i64`. They are saved and included in
  `configHash`. `f32` / `f64` are rejected.
- Object components require `save` and `load` at `registerComponent`.
  `save` writes `Set` and `Map` values with `writeSorted` (string keys in
  UTF-16 order, safe-integer keys in numeric order).
- Transient components are display state. They are not saved and are not
  part of `configHash`. Tick code may `world.add` them and MUST NOT read
  them; a tick read throws, including `entity.hasComponents`. After
  `restoreWorld`, physics ignores `discardedTransientIds` and seeds
  `Interpolation` from `Transform` for every entity that has `Transform`
  and `PhysicsBody`. Object and transient values are a `ValueComponent`.

### 4.4 Entity lifecycle

- Create: `world.createEntity((id) => new Entity(id))` (or a subclass whose
  constructor takes that id) → `addComponent(...)` in the **constructor
  only** → `entityManager.addEntity(entity)`. `createEntity` does not
  register. `createEntityWithId` does. Pool factories are
  `(id: number) => T`.
- Destroy: `entity.destroy()`, then `entityManager.cleanupDestroyed()` in the
  `afterTick` hook, then `dispose()` the returned entities. **Never call
  `entity.dispose()` from game code directly.**
- **Never cache entity references across ticks.** Re-query each tick;
  `queryEntities()` returns results sorted ascending by entity ID (a determinism
  invariant — any optimisation MUST preserve it).

### 4.5 Pooling

Pooling is **engine-driven**. Game code calls exactly two APIs:
`pools.spawn(typeKey, args)` and `pools.despawn(entity)`.

- Never invoke `onSpawn` / `onDespawn` / `onEnable` / `onDisable` /
  `onDestroy` on entities or components yourself.
- Lifecycle order is fixed and MUST NOT change:
  - `onCreate` runs from `addComponent`.
  - spawn: internal storage `onSpawn()` (SoA rows back to constructor
    defaults) → `entity.onSpawn(args)` → `addEntity()` → component
    `onEnable`.
  - despawn: component `onDisable` → `removeEntity()` → `entity.onDespawn()`
    → internal storage `onDespawn()` → return-to-pool hooks → release.
  - `onDestroy` runs from `dispose`, including pool `drain`.
  - The factory's first dormant pass runs despawn hooks and does not call
    `onDisable` (the entity was never enabled).
- `onEnable` also runs after `restoreWorld`. It must not overwrite saved
  fields. Per-spawn writes belong in entity `onSpawn`.
- `addReturnToPoolHook` and `isPoolableComponent` are internal.
  `IPoolableComponent` is exported. Game code
  uses `onEnable` / `onDisable` / `onDestroy`. `SoAComponent.onSpawn` /
  `onDespawn` stay the storage reset.
- `createAbilitySystem` registers an internal return-to-pool hook. The
  first call records the factory shell (attribute `base` / `current` /
  `dirty`, the equipped ability set, and ad-hoc tags plus effect grants,
  including `initComponent` tags). Later calls clear the effect queue and
  `pendingAdd`, copy that shell back, and remove GAS components attached
  after it (`applyEffect`, `addTag`, standalone attributes). The hook is
  idempotent and runs again when a restored free-list entity is parked.
  Factory `pendingAdd` is captured in `initComponent`, before a snapshot
  replaces the list on a restored live entity, and is not part of the
  shell image. `AbilityOwnerSlot.onEnable` copies that capture back
  after a pool spawn.
  `restoreWorld` calls `onEnable('restore')`, which does not reseed, so
  the snapshot's pending list is kept. Attributes, the granted ability set, and `initComponent`
  tags come back from the shell. A free-list entity is not in the GAS
  snapshot; the shell restore is what keeps a respawn whose `onSpawn` does
  not rewrite attributes identical to a restored copy.
- `onSpawn(args)`: typed setter assignments only, **zero allocations**.
  `onDespawn()`: game-level teardown only, **zero allocations**, and **must be
  idempotent**.
- Components are attached once in the entity constructor and live for the
  entity's whole lifetime — never re-add or recreate a component on spawn.
- Register pooled types declaratively via `GameWorldConfig.pooling.entityTypes`
  with `autoPrewarm: true`. If `pool.getStats().missCount > 0` after prewarm,
  raise `initialSize`.
- After `despawn`, the entity's SoA rows are gone. **Never touch a despawned
  entity.**

### 4.6 Events

- Naming: `namespace:verb`. Past tense for facts (`damage:applied`,
  `entity:destroyed`), `:requested` suffix for intents (`move:requested`).
- Subscribe with `this.subscribe<T>(...)` inside `GameSystem` so
  `super.dispose()` auto-unsubscribes. Always call `super.dispose()`.
- Networked player intent arrives via the commands batch; internal simulation
  decisions (AI, chase, pathing) should use direct system calls, not fake
  network commands.
- **Amendment (runtime 0.3):** a _bot slot_ (`SlotConfig` `kind: 'bot'`) is a
  **player**, not in-sim AI. Its `BotPolicy` reads the simulation and emits
  ordinary commands into the command log, exactly like a human slot. This is
  the sanctioned exception to the rule above: unit-level AI (chase, pathing,
  targeting) stays in systems; player-level decisions of a bot slot are
  commands. See `docs/design/runtime-api.md` § Bots.

---

## 5. Abilities (`@phalanx-engine/abilities`)

- **All durations are integer tick counts** — `durationTicks`, `periodTicks`,
  cooldowns. Never milliseconds or seconds.
- Modifier magnitudes MUST be `FixedPoint` (`FP.FromInt` / `FP.FromFloat`),
  never raw `number`.
- `MagnitudeCalculation` callbacks MUST be pure: FP arithmetic only, no random,
  no clock, no external mutable state, no throwing on valid game states
  (`tryGetAttribute` may legitimately return `undefined` — handle it). They
  receive a read-only `AbilityStateReader` and MUST NOT apply effects or
  activate abilities.
- `capturedMagnitudes` are snapshotted at application time; later source changes
  do not retroactively alter an applied modifier. Preserve this semantics.
- `activateAbility()` returns **queued**, not **succeeded**. Observe
  `ABILITY_ACTIVATED_EVENT` for the real thing, and never read attribute
  `current` values before the tick pipeline has run.
- The `providedTarget` object is snapshotted — MUST NOT be mutated after the
  call.
- **Never mutate `gameplayTagsOf(entity).tags` directly.** Use `addTag()`,
  effects with `tagsGranted`, or `removeEffectsByTag()`.
- Tag naming: dot-namespaced PascalCase — `Team.Red`, `Cooldown.Ability.Strike`,
  `State.Debuff.ArmorShred`.
- The ability tick-system order produced by `createAbilitySystem` is canonical:
  activation → effect application → hooks → effect tick → attribute aggregation
  → cue dispatch → cue cleanup. Do not reorder or interleave.
- Cues are **client presentation only**. Never register `CueDispatchSystem` on a
  server world, and never call `applyEffect` from a cue listener.
- Registries are **per world**. Both peers MUST register identical definitions
  before the first entity spawns, or attribute indices diverge.
- AoE/aura targeting is game-side: query targets in a system, then call
  `applyEffect` per target.

---

## 6. Networking (`@phalanx-engine/client` / `@phalanx-engine/server`)

- The protocol is **command-based**. Clients send _intent_
  (`client.sendCommand(type, data)`), never state. Positions, health and
  velocities MUST NOT be transmitted.
- The **server owns the tick clock**. Clients MUST NOT advance the simulation on
  their own; ticks arrive as `commands-batch` and are surfaced through
  `ITickFrameProvider.onTick`.
- Commands are buffered and auto-flushed once per render frame. **Never call
  `submitCommands` / `submitCommandsAsync` manually from inside an `onTick`
  handler.**
- The server sorts commands by `playerId` then `type`. Clients MUST iterate the
  batch in that same sorted order:
  ```ts
  for (const playerId of Object.keys(batch.commands).sort()) { ... }
  ```
- Ready handshake: call `client.sendReady()` **only after** all assets, systems
  and the world are fully initialised. The server's tick loop does not start
  until every player is ready (30 s timeout).
- Server never trusts client-supplied identity: `playerId` is stamped from
  socket data. Validate commands in the `player-command` hook and return `false`
  to reject.
- Reconnection: on `reconnect-state`, replay `recentCommands` in order to
  fast-forward. Honour `randomSeed`, `gameStartEmitted` and countdown fields.
- Desync detection: hash **fixed-point** simulation state via `StateHasher`,
  sorted by stable entity ID. Never hash interpolated/visual floats.
- Pause/resume are server round-trips; act on `gamePaused`/`gameResumed`, never
  optimistically.
- Client tick rate config MUST match the server's `tickRate`.

---

## 7. Testing

- Framework: **Vitest**. `pnpm test` / `pnpm test:watch`.
- Layout: `tests/**/*.test.ts` at package root (math also allows co-located
  `src/**/*.test.ts`). One file per system/feature, named `<Subject>.test.ts`.
- Mandatory isolation:
  ```ts
  beforeEach(() => {
    SoAComponent.useEntityManager(em);
  });
  afterEach(() => {
    SoAComponent.resetContext();
  });
  ```
  Omitting `SoAComponent.resetContext()` leaks global state between tests.
- Unit tests drive the pipeline explicitly with `world.processAllTicks(n)` /
  `world.updateAll(dt)` — do **not** call `world.start()` in unit tests.
- Compare FP values with `FP.Eq/Lt/Gt`, not `==` or `toBeCloseTo`. `toBeCloseTo`
  is only acceptable on values already converted with `FP.ToFloat` for the
  presentation layer.
- Every new deterministic system needs a test that asserts exact FP results, not
  approximate ones. Anything touching pooling needs a spawn→despawn→respawn test
  proving no state leaks between lives.
- Ability tests should use the selective `pipeline` option
  (`'activation' | 'effects' | 'effects-retain-cues' | 'full'`) to isolate
  behaviour.

---

## 8. Public API & Documentation

- Anything exported from a package's `index.ts` is public API. Adding, renaming
  or removing an export is a versioned change; update the package `README.md`
  and the matching `.cursor/skills/<package>/SKILL.md` in the same commit.
- Keep `.cursor/rules/*.mdc` and this file in sync with behaviour changes to
  pooling, determinism or lifecycle ordering.
- Prefer additive changes. If a behaviour is intentionally restricted (e.g.
  `gravityAxis: 'y'` only), document the restriction in the thrown error.

---

## 9. Definition of Done

A change is complete only when all of the following hold:

1. `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm format:check` pass.
2. No new `any`, no new `console.*`, no new float arithmetic on simulation
   values, no new allocations in tick hot paths.
3. Simulation changes are covered by deterministic tests.
4. Tick/frame separation is preserved; no renderer or clock access in the tick
   path.
5. Public API, README and SKILL docs are updated if the surface changed.
