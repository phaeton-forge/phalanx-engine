# Plan: Per-Dispatch Self-Managing Cues (v4)

## Goal

Cue presentation model: **1 dispatched cue event = 1 short-lived, self-managing `Cue`
instance**. A factory (closure, no DI) creates the instance per dispatch; the instance
animates itself, reports completion, and is disposed by the engine.

Target config — map of `cueId → factory`:

```ts
this.abilities = createAbilitySystem(this.world, {
  definitions: combatDefs,
  cues: {
    'Cue.Damage.Sphere': () => new DamageSphereCue(this.scene),
    'Cue.Death': () => new DeathCue(this.scene),
  },
  hooks: {
    'Hook.AutoAttack': (ctx: AbilityActivationContext) => autoAttack(ctx, this.world),
  },
});
```

## Lifecycle (the core model)

For each entry `cueId → factory`:
- Engine subscribes once (at system init) to `gameplayCueKey(cueId)`.
- On each dispatch:
    1. `const cue = factory()`            — fresh instance, presentation deps via closure.
    2. `cue.onSpawn(event, ctx)`          — bind to world: read entities, compute impact,
       build VFX. Returns void; may flag itself done.
    3. push into the engine's active list.
- Each frame (`afterFrame`): `cue.update(dt)` for every live cue; if `cue.isFinished()`,
  call `cue.dispose()` and remove it.
- On world dispose: dispose all live cues.

### Key decisions (locked)
1. **One class per cue type** (no separate handler). The `Cue` IS the effect.
2. **Config is a map `Readonly<Record<string, CueFactory>>`.** The map key is the cue id;
   no `name` field on the class, no probe instance needed to discover the id.
3. **Two-phase init:** `constructor(presentationDeps)` + `onSpawn(event, ctx)`. The
   constructor takes only presentation deps (scene/audio); `event`/`ctx` arrive in
   `onSpawn`. This preserves the `() => new DamageSphereCue(scene)` factory syntax.
4. **Factory invoked per dispatch** (not once at init).
5. **`phalanx-abilities` must NOT import `three`.** Presentation deps injected via closure.
6. **Cues are presentation-only.** Never mutate deterministic simulation state.
7. **`CueContext` stays the narrow read-only projection** `{ entityManager, eventBus }`,
   built from `SystemContext` in `CuePresentationSystem.init()`.
8. **Remove `method: 'buffer'`** from the public API; dispatch is implied by a non-empty
   cues map.

---

## Verified background facts

- `SystemContext` exposes `eventBus`, `entityManager`, `abilities`, `physics`, `pools`,
  `getSystem()` — NO `GameWorld`. Hence `CueContext = { entityManager, eventBus }`.
- `GameWorld` pipeline `beforeFrame → updateAll → afterFrame`; systems implementing
  `IAfterFrame` get `afterFrame(alpha, dt)` automatically.
- `SystemRegistry.registerSystems()` auto-appends `context.abilities.tickSystems` and
  calls `init()` on them.
- `GameSystem.subscribe<T>(eventType, handler)` auto-unsubscribes on `dispose()`.
- `phalanx-abilities` already depends on `phalanx-ecs`.
- Effect definitions reference cues by id (e.g. `cues: ['Cue.Damage.Sphere']`); these ids
  and all `applyEffect(...)` calls are UNCHANGED by this refactor.

---

## Step 1 — Replace base with self-managing `Cue` + factory types

**File:** `phalanx-abilities/src/cues/Cue.ts`

```typescript
import type { EntityManager, EventBus } from 'phalanx-ecs';
import type { GameplayCueDispatchedEvent } from '../events';

/** Narrow, read-only projection of SystemContext. */
export interface CueContext {
  readonly entityManager: EntityManager;
  readonly eventBus: EventBus;
}

/**
 * Short-lived, self-managing presentation effect. ONE instance per dispatched
 * cue event. Presentation-only: never mutate deterministic simulation state.
 *
 * Lifecycle (driven by CuePresentationSystem):
 *  - constructor(deps)     presentation deps (scene/audio) via closure in the factory.
 *  - onSpawn(event, ctx)   bind to world: read entities, compute impact, build VFX.
 *  - update(dt)            per render frame; animate; flag completion.
 *  - isFinished()          true once fully played → engine disposes + removes it.
 *  - dispose()             remove VFX / free resources.
 */
export abstract class Cue {
  /** Bind the freshly created cue to the dispatch event + world services. */
  public abstract onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void;

  /** Per-frame animation. Default: no-op. */
  public update(_deltaTimeSeconds: number): void {}

  /** True once the effect has fully played. Default: never finishes (override!). */
  public isFinished(): boolean {
    return false;
  }

  /** Remove VFX / free resources. Default: no-op. */
  public dispose(): void {}
}

/** Per-dispatch factory. Presentation deps captured via closure (no DI). */
export type CueFactory = () => Cue;

/** Public cue configuration: cue id → factory. */
export type CueConfig = Readonly<Record<string, CueFactory>>;
```

> Note: `isFinished()` defaults to `false`. A cue that never overrides it leaks forever —
> see Step 2 safety note and the dev-warning follow-up.

**File:** `phalanx-abilities/src/cues/index.ts`

```typescript
export { Cue } from './Cue';
export type { CueContext, CueFactory, CueConfig } from './Cue';
```

**Edit:** `phalanx-abilities/src/index.ts` — keep `export * from './cues';`

> Breaking change: old `Cue` (long-lived w/ `name`/`init`/`onDispatched`) and
> `CueConstructor` are gone. Only the playground consumes the cue API so far — acceptable.

---

## Step 2 — Rework CuePresentationSystem to spawn + manage live cues

**File:** `phalanx-abilities/src/systems/CuePresentationSystem.ts`

```typescript
import { GameSystem } from 'phalanx-ecs';
import type { IAfterFrame, SystemContext } from 'phalanx-ecs';
import { gameplayCueKey } from '../events';
import type { GameplayCueDispatchedEvent } from '../events';
import type { Cue, CueConfig, CueContext } from '../cues';

export class CuePresentationSystem extends GameSystem implements IAfterFrame {
  private cueContext!: CueContext;
  private activeCues: Cue[] = [];

  public constructor(private readonly cues: CueConfig) {
    super();
  }

  public override init(context: SystemContext): void {
    super.init(context);
    this.cueContext = {
      entityManager: context.entityManager,
      eventBus: context.eventBus,
    };

    for (const [cueId, factory] of Object.entries(this.cues)) {
      this.subscribe<GameplayCueDispatchedEvent>(
        gameplayCueKey(cueId),
        (event) => {
          const cue = factory();          // fresh instance per dispatch
          cue.onSpawn(event, this.cueContext);
          if (!cue.isFinished()) {        // allow instant cues to self-skip
            this.activeCues.push(cue);
          } else {
            cue.dispose();
          }
        },
      );
    }
  }

  /** No tick work: presentation is afterFrame-only. */
  public override processTick(_tick: number): void {}

    afterFrame(_alpha, dt) {
        const cues = this.activeCues;
        for (let i = cues.length - 1; i >= 0; i--) {
            const cue = cues[i];
            cue.update(dt);
            if (cue.isFinished()) {
                cue.dispose();
                cues[i] = cues[cues.length - 1]; // swap с последним
                cues.pop();                      // убрать хвост, без нового массива
            }
        }
    }

  public override dispose(): void {
    for (const cue of this.activeCues) cue.dispose();
    this.activeCues = [];
    super.dispose();
  }
}
```

> Notes:
> - The post-`onSpawn` `isFinished()` check lets a cue decide it has nothing to show
    >   (e.g. no valid impact point) and bail without ever entering the active list.
> - Survivor-rebuild removal is O(n)/frame; fine for typical VFX counts. Switch to
    >   in-place swap-remove if counts get large.
> - SAFETY: a cue whose `isFinished()` never returns true leaks. Consider a dev-mode
    >   max-lifetime cap (see follow-ups).

**Edit:** `phalanx-abilities/src/systems/index.ts`

```typescript
export { CuePresentationSystem } from './CuePresentationSystem';
```

---

## Step 3 — createAbilitySystem config + buildTickSystems

**File:** `phalanx-abilities/src/api/createAbilitySystem.ts`

### 3a. Config type

Remove `cues?: 'buffer' | 'dispatch'` and any `method` shape. Replace:

```typescript
import type { CueConfig } from '../cues';
import { CuePresentationSystem } from '../systems';

export interface CreateAbilitySystemConfig {
  definitions: AbilitySystemDefinitions;
  hooks?: Record<string, AbilityHook>;
  pipeline?: AbilitySystemPipeline;
  cues?: CueConfig;
}
```

### 3b. Derive

```typescript
const cues: CueConfig = config.cues ?? {};
const hasCues = Object.keys(cues).length > 0;
```

### 3c. Dispatch implied by presence of cues

- `hasCues` → include `CueDispatchSystem` and `CuePresentationSystem`.
- `!hasCues` → neither.
- `CueBufferCleanupSystem` stays where runtime correctness requires it (3d).

### 3d. `buildTickSystems(...)`

Signature: `cues: CueConfig` instead of an array.

```typescript
function buildTickSystems(
  registries: AbilitySystemRegistries,
  runtime: AbilitySystemRuntime,
  pipeline: AbilitySystemPipeline,
  cues: CueConfig,
): GameSystem[] {
  const effectApplication = new EffectApplicationSystem(registries, runtime);
  const effectTick = new EffectTickSystem(registries, runtime);
  const aggregation = new AttributeAggregationSystem(registries);
  const cueCleanup = new CueBufferCleanupSystem(runtime);
  const hasCues = Object.keys(cues).length > 0;

  const systems: GameSystem[] = (() => {
    switch (pipeline) {
      case 'attributes':
        return [aggregation];

      case 'effects':
      case 'effects-retain-cues': {
        const base: GameSystem[] = [effectApplication, effectTick, aggregation];
        if (hasCues) base.push(new CueDispatchSystem(runtime));
        // 'effects' cleans the buffer each tick;
        // 'effects-retain-cues' intentionally RETAINS it regardless of cues.
        if (pipeline === 'effects') base.push(cueCleanup);
        return base;
      }

      case 'activation':
      case 'full':
        // Merged: identical arrays in source. VERIFY; split if 'full' adds systems.
        return [
          new AbilityActivationSystem(registries, runtime),
          effectApplication,
          new AbilityHookExecutorSystem(registries, runtime),
          effectTick,
          aggregation,
          ...(hasCues ? [new CueDispatchSystem(runtime)] : []),
          cueCleanup,
        ];
    }
  })();

  if (hasCues) {
    systems.push(new CuePresentationSystem(cues));
  }
  return systems;
}
```

> `effects-retain-cues` + no cues retains the buffer by design (documented behavior, not a
> leak). Optional dev-guard `console.warn` if used with an empty cues map.

### 3e. Tests observing dispatch without a real VFX cue

Dispatch is implied by a non-empty cues map. A test that only asserts `GAMEPLAY_CUE_EVENT`
emission can register a trivial instant cue:

```typescript
class NoopCue extends Cue {
  public onSpawn(): void {}
  public override isFinished(): boolean { return true; } // never enters active list
}
// config: { 'Cue.Test.Noop': () => new NoopCue() }
```

Export `NoopCue` from `tests/helpers.ts`.

---

## Step 4 — Playground: collapse handler+pool into self-managing cues

**File:** `abilities-playground/src/cues/damageSphereCue.ts`

```typescript
import { Cue } from 'phalanx-abilities';
import type { CueContext, GameplayCueDispatchedEvent } from 'phalanx-abilities';
// ...THREE imports, existing helpers (clamp01, easeOutCubic, createDamageBurstVfx,
//    tryGetImpactPointFromEntities)...

const DURATION_SECONDS = 0.5; // reuse existing constant

export class DamageSphereCue extends Cue {
  private obj: THREE.Object3D | null = null;
  private elapsed = 0;
  private done = false;

  public constructor(private readonly scene: THREE.Scene) {
    super();
  }

  public onSpawn(event: GameplayCueDispatchedEvent, ctx: CueContext): void {
    const impact = tryGetImpactPointFromEntities(ctx.entityManager, event);
    if (!impact) { this.done = true; return; } // nothing to show → engine skips it
    this.obj = createDamageBurstVfx(impact).obj;
    this.scene.add(this.obj);
  }

  public override update(dt: number): void {
    if (this.done || !this.obj) return;
    this.elapsed += dt;
    const t = clamp01(this.elapsed / DURATION_SECONDS);
    animateBurst(this.obj, easeOutCubic(t)); // extracted from old updateCueVfx body
    if (t >= 1) this.done = true;
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.obj) {
      this.scene.remove(this.obj);
      disposeVfx(this.obj);
      this.obj = null;
    }
  }
}
```

- The old `activeVfx: ActiveVfx[]` pool and exported `updateCueVfx` are DELETED — each
  instance owns its single VFX.
- Split the old per-frame loop body into `animateBurst(obj, t)` (module-private).

**File:** `abilities-playground/src/cues/deathCue.ts` — same pattern → `DeathCue` for
`'Cue.Death'`.

---

## Step 5 — SimulationContainer

**File:** `abilities-playground/src/core/SimulationContainer.ts`

```typescript
import { DamageSphereCue, DeathCue } from '../cues';

this.abilities = createAbilitySystem(this.world, {
  definitions: combatDefs,
  cues: {
    'Cue.Damage.Sphere': () => new DamageSphereCue(this.scene),
    'Cue.Death': () => new DeathCue(this.scene),
  },
  hooks: {
    'Hook.AutoAttack': (ctx: AbilityActivationContext) => autoAttack(ctx, this.world),
  },
});
```

- Remove the `private readonly activeCueVfx = [...]` field.
- Remove manual `world.eventBus.on(...)` cue subscriptions.
- Remove `updatePresentation(dtSeconds)` if it only pumped cue VFX; grep the playground
  for `updatePresentation` and remove external call sites.
- Remove now-unused imports (`gameplayCueKey`, `GameplayCueDispatchedEvent`, old cue fns).
- `combatDefs` and all `applyEffect(..., 'Effect.Damage.Sphere', ...)` calls UNCHANGED.

---

## Step 6 — Tests

**File:** `phalanx-abilities/tests/helpers.ts`
- Replace `cues?: 'buffer' | 'dispatch'` with `cues?: CueConfig`, pass through.
- Export `NoopCue` (Step 3e).

**File:** `phalanx-abilities/tests/cuePresentation.test.ts` (rewrite)

Test cue recording calls:
```typescript
class TestCue extends Cue {
  public onSpawnCalls = 0;
  public updates = 0;
  public disposed = false;
  public constructor(private framesToLive: number) { super(); }
  public onSpawn(): void { this.onSpawnCalls++; }
  public override update(): void { this.updates++; this.framesToLive--; }
  public override isFinished(): boolean { return this.framesToLive <= 0; }
  public override dispose(): void { this.disposed = true; }
}
```

Cover:
1. **Factory invoked per dispatch:** spy factory; dispatch twice → factory called twice,
   two live cues.
2. **onSpawn called once per spawn** with the dispatch `CueEvent` + a `CueContext` whose
   `entityManager`/`eventBus` are functional.
3. **update drives each live cue with dt** in afterFrame.
4. **isFinished → dispose + removal** (no further updates after removal).
5. **instant cue (isFinished true right after onSpawn) never enters the active list** and
   is disposed once.
6. **global `GAMEPLAY_CUE_EVENT` still emits** when cues are registered.
7. **world dispose disposes all live cues.**
8. **effects-retain-cues retains buffer** (carry over).

Run the abilities suite; typecheck the playground.

---

## Step 7 — Docs

- `phalanx-abilities/README.md`: replace cue section with the per-dispatch self-managing
  model. Document `Cue` (`onSpawn`/`update`/`isFinished`/`dispose`), `CueContext`,
  `CueFactory`, `CueConfig` (`cueId → factory`), two-phase init, and that the factory runs
  per dispatch. State `buffer` is no longer public. Document `effects-retain-cues`
  retention semantics.
- Update `abilities-playground.plan.md` and prior plan references.

---

## Acceptance criteria

- `phalanx-abilities` exports `Cue`, `CueContext`, `CueFactory`, `CueConfig`,
  `CuePresentationSystem`.
- `phalanx-abilities` does not import `three`.
- Public config: `cues?: CueConfig` (map `cueId → () => Cue`).
- Each dispatch creates a fresh `Cue`; engine calls `onSpawn`, drives `update(dt)`,
  disposes on `isFinished()`.
- `method: 'buffer'` removed; old string/object cue configs do not compile.
- Playground renders damage/death VFX with no manual `activeVfx` pool, no manual
  `eventBus.on` cue subscriptions, no manual `updatePresentation` pump.
- `effects-retain-cues` retention documented + test-covered.
- All tests pass; strict TypeScript, no `any`.

## Open follow-ups

1. **Max-lifetime safety cap:** optionally track per-cue elapsed time in the system and
   force-dispose after a configurable ceiling, so a buggy `isFinished()` can't leak a cue
   forever. Defer until needed; consider a dev-only `console.warn`.
2. **Performance:** swap-remove or pooling if simultaneous cue counts get large.
3. **Multiple VFX per dispatch:** current model = one `Cue` instance per dispatch, which
   may itself manage several sub-objects internally. No API change needed.
4. **Factory allocation churn:** per-dispatch `new` is fine for typical rates; revisit
   with an instance pool only if profiling shows GC pressure.