# Phalanx Abilities

A deterministic gameplay ability system (GAS-inspired) for the [Phalanx Engine](../README.md). Built for lockstep multiplayer: attributes, effects, tags, abilities, targeting, and gameplay cues all run on fixed-point math and tick-aligned ECS systems.

> Sibling packages: [phalanx-ecs](../phalanx-ecs/README.md) (ECS core), [phalanx-math](../phalanx-math/README.md) (fixed-point math).

## Features

- **Attributes**: `base` + `current`, per-definition `min`/`max`, FIFO modifier aggregation (`Add` / `Multiply` / `Override`), clamping
- **Gameplay effects**: `Instant`, `Duration`, `Periodic` with tick-based `durationTicks` / `periodTicks`
- **Gameplay tags**: hierarchical strings (`State.Buff.Speed`), `tagsRequired` / `tagsBlocked` / `tagsGranted` on effects and abilities
- **Abilities**: declarative definitions, activation queue, cost/cooldown via effects, `CanActivate` checks
- **Targeting**: `Self`, `Entity`, `Point` with deterministic resolve
- **Activation hooks**: deterministic callbacks for projectiles and rockets (user-owned entities)
- **Gameplay cues**: per-tick simulation buffer → optional client presentation via self-managing `Cue` instances (VFX/SFX/UI)

### MVP scope

Included in v0.1: flat modifiers, channeling via `Duration` + `removeEffectsByTag`, hooks.
Added in v0.2: **dynamic magnitude calculation** (`Modifier.calculation`) and `setByCaller` — see
[Dynamic magnitudes](#dynamic-magnitudes) below.

Planned for v2: granted abilities, stacking rules, line-of-sight raycast, SoA attribute storage.

## Installation

> Not on npm yet — clone the monorepo and build via pnpm.

```bash
git clone https://github.com/phaeton-forge/phalanx-engine.git
cd phalanx-engine
pnpm install
pnpm --filter @phalanx-engine/abilities build
```

**Peer dependencies:** `@phalanx-engine/ecs` ^0.1.0, `@phalanx-engine/math` ^0.1.0

## Quick start

This example wires **@phalanx-engine/ecs** (`GameWorld`) and **@phalanx-engine/math** (`FP`) into one abilities pipeline.

```typescript
import { Entity, GameWorld, resetEntityIdCounter } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  createAbilitySystem,
  Cue,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  type CueContext,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';

/** Presentation cue — spawned per dispatch, animated in afterFrame. */
class FireballHitCue extends Cue {
  private done = false;

  public onSpawn(event: GameplayCueDispatchedEvent, _ctx: CueContext): void {
    // build VFX from event + ctx.entityManager
  }

  public override update(_dt: number): void {
    // animate each render frame
    if (/* animation complete */) this.done = true;
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    // remove VFX / free resources
  }
}

// 1. Declare attributes, effects, and abilities once (typically a dedicated module).
const combatDefinitions = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(100),
      clamp: 'both',
    }),
    defineAttribute({
      id: 'Mana',
      default: FP.FromInt(50),
      min: FP.FromInt(0),
      max: FP.FromInt(50),
      clamp: 'both',
    }),
  ],
  effects: [
    defineEffect({
      id: 'Effect.Fireball',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-25) }],
      cues: ['Cue.Fireball.Hit'],
    }),
    defineEffect({
      id: 'Effect.Fireball.Cooldown',
      type: 'Duration',
      durationTicks: 30,
      tagsGranted: ['Cooldown.Ability.Fireball'],
    }),
  ],
  abilities: [
    defineAbility({
      id: 'Ability.Fireball',
      costEffectId: undefined,
      cooldownEffectId: 'Effect.Fireball.Cooldown',
      activationBlockedTags: ['Cooldown.Ability.Fireball', 'State.Stun'],
      target: { kind: 'Entity', origin: { kind: 'Caller' } },
      targetEffectIds: ['Effect.Fireball'],
    }),
  ],
});

resetEntityIdCounter();

const world = new GameWorld({ tickRate: 20 });

// 2. Create the ability system and register tick systems on the world.
const abilities = createAbilitySystem(world, {
  definitions: combatDefinitions,
  cues: {
    'Cue.Fireball.Hit': () => new FireballHitCue(),
  },
});

world.registerSystems([...abilities.tickSystems], [], 'default');

// 3. Spawn a combatant with the bundled AbilitySystemComponent.
const hero = new Entity();
const abilityComponent = abilities.initComponent({
  attributes: { Health: FP.FromInt(100), Mana: FP.FromInt(50) },
  abilities: ['Ability.Fireball'],
  tags: ['Team.Hero'],
});
hero.addComponent(abilityComponent);
world.entityManager.addEntity(hero);

// 4. Drive simulation by tick (lockstep-safe).
abilities.activateAbility(hero.id, 'Ability.Fireball', { entityId: enemyId });
world.processAllTicks(currentTick);
// CuePresentationSystem runs in afterFrame — call world.start() or invoke
// afterFrame on frame systems when driving presentation manually in tests.
```

**Tick discipline:** `activateAbility` and `applyEffect` enqueue work. Observable changes (attributes, tags, active effects) apply when ability **tick systems** run inside `world.processAllTicks()` (or your lockstep `beforeTick`/`afterTick` pipeline). Never expect synchronous attribute updates in the same call stack as the facade.

## Architecture

```
createAbilitySystem(world, config)
├── AbilitySystemRegistries     (per-world: attributes, effects, abilities, hooks)
├── AbilitySystemRuntime        (activation queue, instance ids, GameplayCueBuffer)
├── AbilitySystemFacade         (applyEffect, activateAbility, …)
└── tickSystems[]               (registered on GameWorld)

Per simulation tick (client GameWorld):
  AbilityActivationSystem       → CanActivate, cost/cooldown/self effects
  EffectApplicationSystem       → pendingAdd, Instant/Duration/Periodic, tags, OnApplied cues
  AbilityHookExecutorSystem     → hookId callbacks (projectiles, rockets)
  EffectTickSystem              → duration countdown, Periodic ticks, OnExpired cues
  AttributeAggregationSystem    → FIFO modifiers + clamp → current
  CueDispatchSystem?            → CuePresentationSystem (when cues map is non-empty)
  CueBufferCleanupSystem        → clear buffer end of tick (effects/full pipelines)

Per render frame (client GameWorld):
  CuePresentationSystem?        → afterFrame: spawn Cue per dispatch, update(dt), dispose
```

Registries and runtime state are **per `GameWorld`**, not global singletons. Two worlds do not share attribute indices or cue buffers.

Gameplay cues exist only where deterministic simulation runs (typically each **client** `GameWorld`). A headless relay server does not need the cue pipeline.

## Core concepts

### Attributes

Registered with `defineAttribute`. Each entity with an `AbilitySystemComponent` holds `base` and `current` in `BigInt64Array` slots indexed by registration order.

Modifier aggregation (FIFO by `instanceId`):

```
acc = base
for each active effect instance (sorted by instanceId ASC):
  magnitude = modifier.calculation ? capturedEffectiveMagnitude : modifier.magnitude
  Add      → acc = acc + magnitude
  Multiply → acc = acc * magnitude
  Override → acc = magnitude
current = clamp(acc) per AttributeDef
```

`capturedEffectiveMagnitude` is the one-time snapshot described in
[Dynamic magnitudes](#dynamic-magnitudes) below; when no modifier declares a `calculation`,
aggregation is exactly the pre-existing `modifier.magnitude` path.

### Effects

| Type | Behavior |
|------|----------|
| `Instant` | Modifies `base` immediately when applied |
| `Duration` | Stays in `ActiveEffectsComponent.queue` for `durationTicks`; grants tags while active |
| `Periodic` | Duration + fires modifiers every `periodTicks`; optional `executePeriodicOnApplication` |

Durations and periods are **whole simulation ticks** (`number`), compared to `runtime.currentTick` — not `FixedPoint` values.

### Dynamic magnitudes

A `Modifier` can carry an optional `calculation` — a pure, FP-only function (Unreal GAS
`ModMagnitudeCalculation` analog) that computes the modifier's *effective* magnitude at
effect-application time, instead of always using the static `magnitude`:

```typescript
import type { MagnitudeCalcContext, MagnitudeCalculation } from '@phalanx-engine/abilities';

const levelScaledDamage: MagnitudeCalculation = (ctx: MagnitudeCalcContext) => {
  // Fall back to the static magnitude when there is no source (e.g. world hazard)
  // or it has since despawned — tryGetAttribute returns undefined for both.
  const level = ctx.abilities.tryGetAttribute(ctx.sourceEntityId, 'AbilityLevel');
  if (!level) {
    return ctx.baseMagnitude;
  }
  // baseMagnitude * (1 + 0.5 * (level - 1))
  const multiplier = FP.Add(FP.FromInt(1), FP.Mul(FP.FromFloat(0.5), FP.Sub(level.current, FP.FromInt(1))));
  return FP.Mul(ctx.baseMagnitude, multiplier);
};

defineEffect({
  id: 'Effect.AutoAttack.Damage',
  type: 'Instant',
  modifiers: [
    { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-18), calculation: levelScaledDamage },
  ],
});

// AbilitySystemFacade.applyEffect(targetId, effectId, sourceId?, setByCaller?)
abilities.applyEffect(enemyId, 'Effect.AutoAttack.Damage', casterId);
```

`MagnitudeCalcContext`:

| Field | Meaning |
|-------|---------|
| `baseMagnitude` | The modifier's static `magnitude` — use it as a base/default value |
| `sourceEntityId` | The effect's source entity id, or `NO_SOURCE_ENTITY_ID` (`-1`) when there is none. A despawned source is indistinguishable from a valid id here — don't branch on the id, just read through `abilities` |
| `targetEntityId` | The entity the effect is being applied to |
| `abilities` | The same `AbilitySystemFacade` every game system already holds, narrowed to its two read-only methods (`tryGetAttribute`, `hasTag`) — no wrapper object is created for calculations |
| `setByCaller` | `ReadonlyMap<string, any> \| null` — optional per-application payload (SetByCaller analog), passed as the 4th argument to `applyEffect` |
| `effectId` / `attributeId` | The effect and attribute the modifier belongs to |

A calculation reads source/target attributes exactly the way any other game system does:
`ctx.abilities.tryGetAttribute(entityId, attrId)` returns `undefined` when the entity, its
`AttributesComponent`, or the attribute id is missing (including a missing/despawned source) —
no separate reader type to learn, and no allocation per application.

**Snapshot semantics — the one rule to remember:** every modifier's effective magnitude is
computed **exactly once, at application time**, before any mutation:

- **Instant** — the computed value is used immediately instead of `magnitude`.
- **Duration** — the computed value is captured on the `ActiveEffectInstance` and reused for
  the whole lifetime of the effect. Changing the source's attributes afterward — or the source
  despawning — never changes an already-applied Duration modifier.
- **Periodic** — captured the same way at application time; every periodic landing (including
  ones fired via `executePeriodicOnApplication`) reuses the captured value. Recomputing per
  firing is a possible post-MVP addition, not a silent behavior difference.

**Purity/determinism rules:** a `calculation` MUST be pure and FP-only — no floats, no
`Math.random`, no `Date.now()`, no external/mutable state. A calculation that throws propagates
to the caller (same loud-failure philosophy as an unknown effect id); calculations should
handle a missing/despawned source explicitly (typically by falling back to `baseMagnitude`)
rather than throwing for valid game states.

**Backward compatible:** modifiers that omit `calculation` behave byte-for-byte as before —
this is a zero-overhead opt-in feature.

### Abilities

`defineAbility` describes activation rules. On success, the activation system applies `costEffectId`, `cooldownEffectId`, and `selfEffectIds` to the caster, resolves `target`, applies `targetEffectIds`, then runs `hookId` if set.

`activateAbility` returns `true` when the request is **queued**, not when it ultimately succeeds. Listen for `ABILITY_ACTIVATED_EVENT` on the world `EventBus` for the final verdict and resolved targets.

### Gameplay tags

- **Effect-granted**: from `tagsGranted`; removed when the effect expires or is stripped via `removeEffectsByTag`
- **Ad-hoc**: `abilities.addTag` / `removeTag` for spawn setup (teams, factions)
- **Ability gates**: `tagsRequired`, `activationBlockedTags` on `AbilityDef`; effect `tagsRequired` / `tagsBlocked` on targets

### Targeting

```typescript
type TargetSpec =
  | { kind: 'Self' }
  | { kind: 'Entity'; origin: TargetOrigin }
  | { kind: 'Point'; origin: TargetOrigin };

type TargetOrigin =
  | { kind: 'Caster' }
  | { kind: 'TargetEntity'; entityId: number }
  | { kind: 'Point'; x: FixedPoint; z: FixedPoint }
  | { kind: 'Caller' }; // reads activateAbility(..., providedTarget)
```

### Activation hooks

Register in `createAbilitySystem({ hooks: { ... } })` or `facade.registerHook`. Hooks run **after** cost/cooldown/self effects on the activation tick. Use for spawning projectiles/rockets (entities live in **your** game code, not in this package).

```typescript
import type { AbilityHook } from '@phalanx-engine/abilities';

const spawnProjectile: AbilityHook = (ctx) => {
  // ctx.abilityId, ctx.casterEntityId, ctx.resolvedTargets, ctx.providedTarget, ctx.tick
  // Spawn projectile entity; on hit call abilities.applyEffect(targetId, 'Effect.Damage', casterId)
};
```

## Gameplay ability recipes

These five patterns match the arena-shooter target game. Projectiles and damage multipliers outside pure GAS math are called out explicitly.

### 1. Auto-attack (projectile on hit)

Ability applies cooldown; hook spawns the projectile; damage is an **Instant** effect on impact.

```typescript
defineEffect({
  id: 'Effect.AutoAttack.Cooldown',
  type: 'Duration',
  durationTicks: 30,
  tagsGranted: ['Cooldown.Ability.AutoAttack'],
});
defineEffect({
  id: 'Effect.AutoAttack.Damage',
  type: 'Instant',
  modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
  cues: ['Cue.AutoAttack.Hit'],
});
defineAbility({
  id: 'Ability.AutoAttack',
  cooldownEffectId: 'Effect.AutoAttack.Cooldown',
  activationBlockedTags: ['Cooldown.Ability.AutoAttack', 'State.Stun'],
  target: { kind: 'Entity', origin: { kind: 'Caller' } },
  hookId: 'Hook.SpawnProjectile.AutoAttack',
});

// In hooks['Hook.SpawnProjectile.AutoAttack']: spawn projectile entity.
// On hit: abilities.applyEffect(targetId, 'Effect.AutoAttack.Damage', casterId);
```

### 2. Health regeneration (Periodic Effect)

```typescript
defineEffect({
  id: 'Effect.HealthRegen',
  type: 'Periodic',
  periodTicks: 60,
  durationTicks: 600,
  modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(5) }],
});
defineAbility({
  id: 'Ability.HealthRegen',
  target: { kind: 'Self' },
  targetEffectIds: ['Effect.HealthRegen'],
});
```

### 3. Armor-shred beam (channeling)

```typescript
defineEffect({
  id: 'Effect.ArmorShred',
  type: 'Duration',
  durationTicks: 300,
  modifiers: [{ attributeId: 'Armor', op: 'Add', magnitude: FP.FromInt(-20) }],
  tagsGranted: ['State.Debuff.ArmorShred'],
});
defineAbility({
  id: 'Ability.ArmorShredBeam',
  target: { kind: 'Entity', origin: { kind: 'Caller' } },
  targetEffectIds: ['Effect.ArmorShred'],
});

// On beam release (input system, same tick discipline):
abilities.removeEffectsByTag(targetId, 'State.Debuff.ArmorShred');
```

### 4. Mark beam (damage multiplier — user-side)

The library stores `IncomingDamageMultiplier` on the target; **your** damage pipeline must read it when applying damage.

```typescript
defineAttribute({
  id: 'IncomingDamageMultiplier',
  default: FP.FromInt(1),
  min: FP.FromInt(0),
  max: FP.FromInt(10),
  clamp: 'both',
});
defineEffect({
  id: 'Effect.Marked',
  type: 'Duration',
  durationTicks: 240,
  modifiers: [
    { attributeId: 'IncomingDamageMultiplier', op: 'Multiply', magnitude: FP.FromFloat(1.25) },
  ],
  tagsGranted: ['State.Marked'],
});

function applyDamageWithMark(
  abilities: AbilitySystem,
  targetId: number,
  baseDamage: FixedPoint
): void {
  const mult =
    abilities.tryGetAttribute(targetId, 'IncomingDamageMultiplier')?.current ?? FP.FromInt(1);
  const scaled = FP.Mul(baseDamage, mult);
  // apply Instant damage effect or direct Health modifier with `scaled`
}
```

This is an intentional MVP limitation for `IncomingDamageMultiplier`-style attributes read
before `applyEffect`; for scaling a modifier's own magnitude from an attribute, prefer
`Modifier.calculation` (see [Dynamic magnitudes](#dynamic-magnitudes)) instead of pre-computing
and passing a raw magnitude.

### 5. Custom execution formulas

For formulas that only depend on attributes already known to the caller (e.g.
`IncomingDamageMultiplier`), read them from the facade and calculate manually before calling
`applyEffect` — this remains a valid, simple pattern:

```typescript
defineEffect({
  id: 'Effect.Damage.Marked',
  type: 'Instant',
  modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
  cues: ['Cue.Hit'],
});

const targetMarked = abilities.hasTag(enemyId, 'State.Marked');
if (targetMarked) {
  abilities.applyEffect(enemyId, 'Effect.Damage.Marked');
}
```

For formulas that need to read the **source**'s attributes at application time (e.g.
`Damage = Base * levelMultiplier(source.AbilityLevel)`), or need a per-application payload
(SetByCaller), declare a `Modifier.calculation` instead — see
[Dynamic magnitudes](#dynamic-magnitudes).

## Gameplay cues

Cues are deterministic simulation-side notifications for local presentation (VFX, SFX, UI). They are **not** networked. Simulation systems write cue events into an internal per-tick buffer; when you register client presentation, the engine dispatches each event and spawns a short-lived `Cue` instance to animate it.

### Simulation pipeline

```text
simulation systems → GameplayCueBuffer → CueDispatchSystem → CuePresentationSystem
                                      → CueBufferCleanupSystem (end of tick)
```

`GameplayCueBuffer` is internal runtime state on `AbilitySystemRuntime` — not a public config option and not an entity component. For tests, use `pipeline: 'effects-retain-cues'` to keep buffered events across ticks without dispatch.

Effects declare cues as a shortcut array (OnApplied only) or structured phases:

```typescript
defineEffect({
  id: 'Effect.Poison',
  type: 'Periodic',
  durationTicks: 6,
  periodTicks: 2,
  cues: {
    onApplied: ['Cue.Poison.Apply'],
    onPeriodic: ['Cue.Poison.Tick'],
    onExpired: ['Cue.Poison.Expire'],
  },
});
```

### Per-dispatch self-managing `Cue` model

**One dispatched cue event = one short-lived `Cue` instance.** Register factories in `createAbilitySystem`:

```typescript
import { Cue, type CueConfig, type CueContext, type GameplayCueDispatchedEvent } from '@phalanx-engine/abilities';

const cues: CueConfig = {
  'Cue.Damage.Sphere': () => new DamageSphereCue(scene),
  'Cue.Death': () => new DeathCue(scene),
};

createAbilitySystem(world, { definitions, cues });
```

| Type | Role |
|------|------|
| `Cue` | Abstract base: `onSpawn`, `update(dt)`, `isFinished()`, `dispose()` |
| `CueContext` | Read-only `{ entityManager, eventBus }` — no `GameWorld` |
| `CueFactory` | `() => Cue` — invoked **per dispatch**, not once at init |
| `CueConfig` | `Readonly<Record<string, CueFactory>>` — map key is the cue id |

**Two-phase init:** the factory closure captures presentation deps (scene, audio); `onSpawn(event, ctx)` binds the instance to the dispatch event and world services.

```typescript
export class DamageSphereCue extends Cue {
  private done = false;

  public constructor(private readonly scene: THREE.Scene) {
    super();
  }

  public onSpawn(event: GameplayCueDispatchedEvent, ctx: CueContext): void {
    const impact = resolveImpact(ctx.entityManager, event);
    if (!impact) {
      this.done = true; // nothing to show — engine skips the active list
      return;
    }
    this.scene.add(createBurstVfx(impact));
  }

  public override update(dt: number): void {
    // animate each render frame
    if (/* animation complete */) this.done = true;
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    // remove VFX / free resources
  }
}
```

**Lifecycle** (driven by `CuePresentationSystem`):

1. Engine subscribes once per `cueId` to `gameplayCueKey(cueId)` on init.
2. On each dispatch: `factory()` → `onSpawn(event, ctx)` → active list if not `isFinished()`.
3. Each `afterFrame`: `update(dt)`; when `isFinished()`, `dispose()` and remove.
4. On world dispose: dispose all live cues.

Cues are **presentation-only** — never call `applyEffect` / `activateAbility` from cue code. `phalanx-abilities` does not import rendering libraries; inject scene/audio via the factory closure.

A non-empty `cues` map automatically registers `CueDispatchSystem` and `CuePresentationSystem`. Omit `cues` (or pass `{}`) for headless/simulation-only worlds; `CueBufferCleanupSystem` still runs where the pipeline requires it.

### Pipeline: `effects-retain-cues`

`pipeline: 'effects-retain-cues'` runs effect systems but **does not** clear the cue buffer each tick — useful for asserting buffered events in tests. It does not register dispatch or presentation unless you also pass a non-empty `cues` map. Using it with an empty `cues` map intentionally retains the buffer without dispatch (dev warning in non-production builds).

## Determinism rules

- Use `FP.*` from `phalanx-math` for all modifier magnitudes
- Store durations as integer **ticks**, not floats or `Date.now`
- Target resolution is snapshotted at activation; movement after activation does not change which entity or point was targeted
- Call `resetEntityIdCounter()` from `phalanx-ecs` at match start so projectile spawns get identical ids on every peer
- Hooks must be pure deterministic simulation — no `Math.random()` or wall-clock time

## API reference

### Factory

```typescript
createAbilitySystem(world: GameWorld, config: CreateAbilitySystemConfig): AbilitySystem
```

| Config field | Purpose |
|--------------|---------|
| `definitions` | `defineAbilitySystem({ attributes, effects?, abilities? })` |
| `hooks` | `Record<hookId, AbilityHook>` |
| `pipeline` | `'full'` (default), `'activation'`, `'effects'`, `'effects-retain-cues'`, `'attributes'` |
| `cues` | `CueConfig` — `cueId → () => Cue`. Non-empty map registers dispatch + presentation |

### `AbilitySystem` (returned by factory)

| Method | Description |
|--------|-------------|
| `initComponent(init?)` | Create `AbilitySystemComponent` with optional seed data |
| `activateAbility(casterId, abilityId, providedTarget?)` | Queue activation |
| `applyEffect(targetId, effectId, sourceId?, setByCaller?)` | Queue effect (`sourceId` defaults to `-1`; `setByCaller` is an optional `ReadonlyMap<string, any>` forwarded to `Modifier.calculation`) |
| `getAttribute` / `tryGetAttribute` | Read base/current |
| `hasTag` / `addTag` / `removeTag` | Tag queries and ad-hoc tags |
| `removeEffectsByTag` / `removeEffectsByDefId` | Flag instances for removal next tick |
| `tickSystems` | Register on `GameWorld` |

Lower-level access: `AbilitySystemFacade` is exported for advanced wiring; most games use `createAbilitySystem` only.

### DSL helpers

```typescript
defineAttribute(def: AttributeDef): AttributeDef
defineEffect(def: EffectDefInput): EffectDef
defineAbility(def: AbilityDef): AbilityDef
defineAbilitySystem(bundle): AbilitySystemDefinitions
```

### Events

```typescript
import {
  ABILITY_ACTIVATED_EVENT,
  type AbilityActivatedEvent,
  Cue,
  CuePresentationSystem,
  GAMEPLAY_CUE_EVENT,
  gameplayCueKey,
  type CueConfig,
  type CueContext,
  type CueFactory,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
```

### Components and types

Exported: `AbilitySystemComponent`, `AbilitiesComponentType`, effect/attribute/tag types, individual systems for custom pipelines.

See `src/index.ts` for the full public surface.

## Integration checklist

1. **phalanx-ecs**: `GameWorld`, `Entity`, `resetEntityIdCounter`, register `abilities.tickSystems` in deterministic order alongside movement/physics/combat systems.
2. **phalanx-math**: `FP.FromInt`, `FP.FromFloat`, `FP.Add`, `FP.Mul`, etc. for all magnitudes.
3. **Client-only cues**: pass a non-empty `cues` map with `Cue` subclasses; presentation runs in `afterFrame`. Never mutate simulation from cue code.
4. **User-owned systems**: projectiles, rockets, AoE searches, and Aura ticking stay in game code. Call `applyEffect` or `activateAbility` from these systems on deterministic events (collision, timer tick).

## Testing

```bash
pnpm --filter @phalanx-engine/abilities test
```

Tests use `GameWorld.processAllTicks()` with pipeline subsets (`activation`, `effects`, …). See `tests/helpers.ts` for patterns.

## Agent skill

For AI-assisted development, use the repository skill:

[`skills/phalanx-abilities/SKILL.md`](../skills/phalanx-abilities/SKILL.md)

It covers decision trees, the five recipes above, determinism rules, and anti-patterns when extending combat systems.

## License

Same as the Phalanx Engine monorepo.
