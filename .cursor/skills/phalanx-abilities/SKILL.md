---
name: phalanx-abilities
description: Create deterministic gameplay abilities, effects, attributes, tags, and activation hooks using phalanx-abilities from the phalanx-engine repository. Use when building GAS-style combat, buffs, cooldowns, channeling, or integrating abilities with phalanx-ecs GameWorld. Covers defineAttribute/defineEffect/defineAbility, createAbilitySystem, AbilitySystemFacade, dynamic magnitude calculation (Modifier.calculation, setByCaller), gameplay cues, and lockstep determinism.
metadata:
  author: phaeton2040-AI
  version: '1.0'
---

# Phalanx Abilities Skill

## When to Use This Skill

Use this skill when the user asks to:

- Add a gameplay ability system to a Phalanx ECS game
- Define attributes, buffs, debuffs, cooldowns, or costs
- Add activation hooks for projectiles or rockets
- Implement channeling (beam on / beam off) with tag-driven effect removal
- Set up gameplay cues for VFX/SFX on the client `GameWorld`
- Debug non-deterministic combat or lockstep attribute desync

## Prerequisites

- TypeScript project with strict mode
- `phalanx-ecs` — `GameWorld`, `Entity`, `GameSystem`, `EventBus`, `resetEntityIdCounter`
- `phalanx-math` - `FP`, `FixedPoint` (all magnitudes)
- Read [`phalanx-abilities/README.md`](../../phalanx-abilities/README.md) for full API detail

## Architecture Overview

```
GameWorld (phalanx-ecs)
├── createAbilitySystem(world, config)
│   ├── AbilitySystemRegistries   (per-world defs)
│   ├── AbilitySystemRuntime      (activation FIFO, instance ids, GameplayCueBuffer)
│   ├── AbilitySystemFacade       (enqueue API)
│   └── tickSystems[]             → world.registerSystems([...abilities.tickSystems], [])
Per tick (full pipeline):
  AbilityActivationSystem → EffectApplicationSystem → AbilityHookExecutorSystem
  → EffectTickSystem → AttributeAggregationSystem
  → [CueDispatchSystem] → CueBufferCleanupSystem
Per frame (when cues map is non-empty):
  CuePresentationSystem → afterFrame: Cue.update(dt), dispose on isFinished()
```

**Critical:** Facade methods enqueue work; state changes appear after `processAllTicks()` (or lockstep tick). `activateAbility` returning `true` means queued, not necessarily successful.

## Step-by-Step Instructions

### 1. Declare definitions

```typescript
import { FP } from '@phalanx-engine/math';
import {
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
} from '@phalanx-engine/abilities';

export const combatDefs = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: FP.FromInt(100),
      min: FP.FromInt(0),
      max: FP.FromInt(100),
      clamp: 'both',
    }),
  ],
  effects: [
    defineEffect({
      id: 'Effect.Damage10',
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
    }),
  ],
  abilities: [
    defineAbility({
      id: 'Ability.Strike',
      target: { kind: 'Entity', origin: { kind: 'Caller' } },
      targetEffectIds: ['Effect.Damage10'],
    }),
  ],
});
```

### 2. Create ability system on GameWorld

```typescript
import { GameWorld, resetEntityIdCounter } from '@phalanx-engine/ecs';
import { createAbilitySystem } from '@phalanx-engine/abilities';

resetEntityIdCounter();
const world = new GameWorld({ tickRate: 20 });

const abilities = createAbilitySystem(world, {
  definitions: combatDefs,
  hooks: { 'Hook.SpawnProjectile': myHook },
  cues: {
    'Cue.Hit': () => new HitCue(scene),
  },
});

world.registerSystems([...abilities.tickSystems], [], 'default');
```

### 3. Equip entities

Prefer the bundled component:

```typescript
import { Entity } from '@phalanx-engine/ecs';

const unit = new Entity();
unit.addComponent(
  abilities.initComponent({
    attributes: { Health: FP.FromInt(100) },
    abilities: ['Ability.Strike'],
    tags: ['Team.Red'],
  })
);
world.entityManager.addEntity(unit);
```

### 4. Activate and advance ticks

```typescript
import { ABILITY_ACTIVATED_EVENT, type AbilityActivatedEvent } from '@phalanx-engine/abilities';

world.eventBus.on<AbilityActivatedEvent>(ABILITY_ACTIVATED_EVENT, (e) => {
  console.log(e.abilityId, e.resolvedTargets);
});

abilities.activateAbility(casterId, 'Ability.Strike', { entityId: targetId });
world.processAllTicks(tick);
```

### 5. Optional: custom `Cue` subclasses

Register self-managing `Cue` subclasses in the `cues` map (see README). The factory runs per dispatch; `CuePresentationSystem` drives `update(dt)` in `afterFrame`:

```typescript
import { Cue, type CueContext, type GameplayCueDispatchedEvent } from '@phalanx-engine/abilities';

class HitCue extends Cue {
  private done = false;

  public constructor(private readonly scene: Scene) {
    super();
  }

  public onSpawn(event: GameplayCueDispatchedEvent, ctx: CueContext): void {
    // build VFX from event + ctx.entityManager
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

## Decision Trees

### Effect type

| Need | Type |
|------|------|
| Immediate damage/heal/mana spend | `Instant` |
| Buff/debuff for N ticks | `Duration` + `durationTicks` |
| DoT/HoT every N ticks | `Periodic` + `durationTicks` + `periodTicks` |
| Cooldown or “on cooldown” tag | `Duration` on caster with `tagsGranted: ['Cooldown.Ability.X']` |

### Targeting

| Need | TargetSpec |
|------|------------|
| Self-buff | `{ kind: 'Self' }` |
| Single target from click | `{ kind: 'Entity', origin: { kind: 'Caller' } }` + `providedTarget.entityId` |
| Ground target | `{ kind: 'Point', origin: { kind: 'Caller' } }` + `providedTarget.x/z` |

### Hook vs targetEffectIds

| Pattern | Use |
|---------|-----|
| Damage/buff applied directly to resolved targets | `targetEffectIds` |
| Spawn projectile/rocket entity | `hookId` + `registerHook` / `hooks` config |
| Hit damage after projectile travels | Hook spawns entity; **on hit** call `applyEffect` (not `targetEffectIds`) |


### Channeling

| Pattern | Use |
|---------|-----|
| Beam while held | `Duration` effect via `targetEffectIds` while channeling |
| Beam released | `removeEffectsByTag(targetId, 'State.Debuff.X')` from input/command system same tick discipline |

## Recipes (target game patterns)

### Auto-attack (projectile)

```typescript
defineAbility({
  id: 'Ability.AutoAttack',
  cooldownEffectId: 'Effect.AutoAttack.Cooldown',
  activationBlockedTags: ['Cooldown.Ability.AutoAttack'],
  target: { kind: 'Entity', origin: { kind: 'Caller' } },
  hookId: 'Hook.SpawnProjectile.AutoAttack',
});
// Hook spawns projectile; on hit: abilities.applyEffect(target, 'Effect.AutoAttack.Damage', caster);
```

### Health regeneration (Periodic Effect)

```typescript
defineAbility({
  id: 'Ability.HealthRegen',
  target: { kind: 'Self' },
  targetEffectIds: ['Effect.HealthRegen'],
});
// Effect.HealthRegen type: 'Periodic' with durationTicks/periodTicks
```

### Armor-shred beam

```typescript
defineAbility({
  id: 'Ability.ArmorShredBeam',
  target: { kind: 'Entity', origin: { kind: 'Caller' } },
  targetEffectIds: ['Effect.ArmorShred'],
});
// On release: abilities.removeEffectsByTag(targetId, 'State.Debuff.ArmorShred');
```

### Mark beam (user-side damage multiplier)

```typescript
// Effect.Marked sets IncomingDamageMultiplier via Multiply modifier.
// Game damage helper:
const mult =
  abilities.tryGetAttribute(targetId, 'IncomingDamageMultiplier')?.current ?? FP.FromInt(1);
const damage = FP.Mul(baseDamage, mult);
```

For scaling a modifier's own magnitude from a source attribute at application time, prefer
`Modifier.calculation` (below) over this manual read-then-apply pattern.

### Dynamic magnitude calculation (ability-level-scaled damage)

`Modifier.calculation` (Unreal GAS `ModMagnitudeCalculation` analog) lets an effect's magnitude
be computed from source/target attributes and an optional per-application `setByCaller` payload,
evaluated **once at effect-application time** — not on every tick.

```typescript
import type { MagnitudeCalcContext, MagnitudeCalculation } from '@phalanx-engine/abilities';

const levelScaledDamage: MagnitudeCalculation = (ctx: MagnitudeCalcContext) => {
  // ctx.abilities is the same AbilitySystemFacade every game system already holds,
  // narrowed to tryGetAttribute/hasTag — no wrapper reader object is created.
  const level = ctx.abilities.tryGetAttribute(ctx.sourceEntityId, 'AbilityLevel');
  if (!level) {
    return ctx.baseMagnitude; // no source / despawned source: fall back to base
  }
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

// setByCaller (4th arg) forwards a ReadonlyMap into ctx.setByCaller — e.g. a chain-lightning
// per-jump falloff index looked up in an FP falloff table.
abilities.applyEffect(targetId, 'Effect.AutoAttack.Damage', casterId, new Map([['jumpIndex', 2]]));
```

**When to use `calculation` vs static `magnitude` vs manual pre-computation:**

| Need | Approach |
|------|----------|
| Fixed magnitude, no per-source scaling | Static `magnitude` on the `Modifier` |
| Magnitude scales with the **source's** attributes (ability level, stat) | `Modifier.calculation` reading `ctx.abilities.tryGetAttribute(ctx.sourceEntityId, ...)` |
| Magnitude scales with data known only at the call site (e.g. chain-lightning jump index) | `Modifier.calculation` reading `ctx.setByCaller` |
| Magnitude scales with an attribute already on the **target**, read before calling `applyEffect` | Either manual pre-computation (`tryGetAttribute` + calculate) or `calculation` reading `ctx.abilities.tryGetAttribute(ctx.targetEntityId, ...)` — prefer `calculation` for anything reused across many call sites |

**Snapshot semantics:** the effective magnitude is computed exactly once, at application time:
- `Instant` — used immediately.
- `Duration` / `Periodic` — captured on the `ActiveEffectInstance` and reused for the whole
  lifetime / every periodic landing. The source's attributes changing afterward, or the source
  despawning, never retroactively changes an already-applied modifier.

**Determinism:** a `calculation` MUST be pure and FP-only (no floats, `Math.random`,
`Date.now()`, or external state) and must not throw for valid game states — a missing/despawned
source simply makes `ctx.abilities.tryGetAttribute(ctx.sourceEntityId, ...)` return `undefined`;
handle that explicitly (typically falling back to `baseMagnitude`).

**Design note:** there is no `AttributeReader`/wrapper-reader abstraction. Calculations receive
`sourceEntityId` / `targetEntityId` plus the facade itself (typed as the narrow `AbilityStateReader`
interface) — the same object and API every other game system uses, so nothing new has to be
instantiated or learned just for magnitude calculations.

### Custom execution formulas

For formulas over attributes already known to the caller before `applyEffect` (e.g.
`IncomingDamageMultiplier`), read-then-calculate remains valid:

```typescript
const mult =
  abilities.tryGetAttribute(targetId, 'IncomingDamageMultiplier')?.current ?? FP.FromInt(1);
const damage = FP.Mul(baseDamage, mult);
```

For formulas needing the **source's** attributes at application time or a setByCaller payload,
use `Modifier.calculation` instead (see above).

## phalanx-ecs integration

- Register `abilities.tickSystems` with other tick systems in **fixed order** (typically: input/commands → abilities activation → movement → physics → game reactions)
- Use `resetEntityIdCounter()` at match start before spawning entities
- Subscribe to `ABILITY_ACTIVATED_EVENT` for UI feedback; do not rely on synchronous `activateAbility` return value for success
- Attach `AbilitySystemComponent` via `abilities.initComponent()` rather than low-level attribute/tag components unless testing internals
- `GameplayCueBuffer` is world-scoped runtime — not an `IComponent`

## Determinism Rules

- All modifier magnitudes: `FP.FromInt` / `FP.FromFloat` — never raw `number` in defs
- Durations: integer `durationTicks` / `periodTicks`, not seconds
- No `Math.random`, `Date.now`, or native float math in hooks
- `activateAbility` snapshots `providedTarget` — do not mutate the object after the call
- AoE and Auras are **user-side**: implement radius searches and periodic aura ticks in your own game systems, then call `applyEffect` on targets.
- `applyEffect` source default: `NO_SOURCE_ENTITY_ID` (`-1`) when omitted
- `applyEffect(targetId, effectId, sourceId?, setByCaller?)` — `setByCaller` is an optional
  `ReadonlyMap<string, unknown>` forwarded into `MagnitudeCalcContext.setByCaller` for any
  `Modifier.calculation` the effect's modifiers declare
- `Modifier.calculation` MUST be pure and FP-only; snapshot semantics mean it runs exactly once
  per application, never per tick/landing (see Dynamic magnitude calculation recipe above)
- Effect removal via `removeEffectsByTag` flags `remainingTicks = 0`; processed next `EffectTickSystem` pass
- Two peers must register identical definitions before any entity spawns

## Anti-Patterns

| Anti-pattern | Why |
|--------------|-----|
| Expect `activateAbility` === success | Only means queued; listen to `ABILITY_ACTIVATED_EVENT` |
| Read `current` attribute immediately after `applyEffect` | Wait for tick systems + aggregation |
| `applyEffect` from cue listeners | Breaks determinism; use command/input systems |
| Global attribute/effect registries | Registries are per `createAbilitySystem` / world |
| Mutate `GameplayTagsComponent.tags` directly | Use `addTag` / effects / `removeEffectsByTag` |
| Server relay simulating cues | Cues belong on client `GameWorld` only |

## Exports from phalanx-abilities

```typescript
// Factory + DSL
import {
  createAbilitySystem,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  defineAbility,
  abilityComponentTypes,
  type AbilitySystem,
  type CreateAbilitySystemConfig,
  type AbilitySystemPipeline,
} from '@phalanx-engine/abilities';

// Facade (advanced)
import {
  AbilitySystemFacade,
  NO_SOURCE_ENTITY_ID,
  type AttributeValue,
} from '@phalanx-engine/abilities';

// Components
import {
  AbilitySystemComponent,
  AbilitiesComponentType,
} from '@phalanx-engine/abilities';

// Events & cues
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

// Types
import type {
  AttributeDef,
  EffectDef,
  AbilityDef,
  TargetSpec,
  ProvidedTarget,
  AbilityHook,
  AbilityActivationContext,
  Modifier,
  ModifierOp,
  AbilityStateReader,
  MagnitudeCalcContext,
  MagnitudeCalculation,
} from '@phalanx-engine/abilities';

// Systems (custom pipelines)
import {
  AbilityActivationSystem,
  EffectApplicationSystem,
  EffectTickSystem,
  AttributeAggregationSystem,
  AbilityHookExecutorSystem,
  CueDispatchSystem,
  CuePresentationSystem,
  CueBufferCleanupSystem,
} from '@phalanx-engine/abilities';
```

## Testing patterns

```typescript
import { resetEntityIdCounter, GameWorld } from '@phalanx-engine/ecs';
import { createAbilitySystem, defineAbilitySystem } from '@phalanx-engine/abilities';

resetEntityIdCounter();
const world = new GameWorld({});
const abilities = createAbilitySystem(world, {
  definitions: myDefs,
  pipeline: 'activation', // or 'effects', 'full'
});
world.registerSystems([...abilities.tickSystems], []);
world.processAllTicks(2);
```

Use `pipeline: 'effects-retain-cues'` to assert on `abilities.gameplayCueBuffer` before cleanup. Pass a non-empty `cues` map (e.g. a `NoopCue` factory in test helpers) when you need `GAMEPLAY_CUE_EVENT` dispatch in tests.

## Related skills

- `phalanx-ecs` — GameWorld, entities, systems, lockstep
- `phalanx-math` — fixed-point arithmetic (use with all ability magnitudes)
