---
name: phalanx-abilities
description: Create deterministic gameplay abilities, effects, attributes, tags, and activation hooks using phalanx-abilities from the phalanx-engine repository. Use when building GAS-style combat, buffs, cooldowns, channeling, or integrating abilities with phalanx-ecs GameWorld. Covers defineAttribute/defineEffect/defineAbility, createAbilitySystem, AbilitySystemFacade, gameplay cues, and lockstep determinism.
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
import { FP } from 'phalanx-math';
import {
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
} from 'phalanx-abilities';

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
import { GameWorld, resetEntityIdCounter } from 'phalanx-ecs';
import { createAbilitySystem } from 'phalanx-abilities';

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
import { Entity } from 'phalanx-ecs';

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
import { ABILITY_ACTIVATED_EVENT, type AbilityActivatedEvent } from 'phalanx-abilities';

world.eventBus.on<AbilityActivatedEvent>(ABILITY_ACTIVATED_EVENT, (e) => {
  console.log(e.abilityId, e.resolvedTargets);
});

abilities.activateAbility(casterId, 'Ability.Strike', { entityId: targetId });
world.processAllTicks(tick);
```

### 5. Optional: custom `Cue` subclasses

Register self-managing `Cue` subclasses in the `cues` map (see README). The factory runs per dispatch; `CuePresentationSystem` drives `update(dt)` in `afterFrame`:

```typescript
import { Cue, type CueContext, type GameplayCueDispatchedEvent } from 'phalanx-abilities';

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

Not automatic in the library (MVP) — v2 execution calculations may absorb this.

### Custom execution formulas

`phalanx-abilities` doesn't support complex math inside effect definitions yet. For complex formulas (e.g. `Damage = (Base + Strength * 2) * (1 - Armor / 100)`), read the attributes from the facade and calculate manually before calling `applyEffect`.

```typescript
const mult =
  abilities.tryGetAttribute(targetId, 'IncomingDamageMultiplier')?.current ?? FP.FromInt(1);
const damage = FP.Mul(baseDamage, mult);
```

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
} from 'phalanx-abilities';

// Facade (advanced)
import {
  AbilitySystemFacade,
  NO_SOURCE_ENTITY_ID,
  type AttributeValue,
} from 'phalanx-abilities';

// Components
import {
  AbilitySystemComponent,
  AbilitiesComponentType,
} from 'phalanx-abilities';

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
} from 'phalanx-abilities';

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
} from 'phalanx-abilities';

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
} from 'phalanx-abilities';
```

## Testing patterns

```typescript
import { resetEntityIdCounter, GameWorld } from 'phalanx-ecs';
import { createAbilitySystem, defineAbilitySystem } from 'phalanx-abilities';

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
