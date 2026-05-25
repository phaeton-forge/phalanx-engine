---
name: phalanx-abilities
description: Create deterministic gameplay abilities, effects, attributes, tags, AoE targeting, auras, and activation hooks using phalanx-abilities from the phalanx-engine repository. Use when building GAS-style combat, buffs, cooldowns, channeling, or integrating abilities with phalanx-ecs GameWorld and optional phalanx-physics spatial queries. Covers defineAttribute/defineEffect/defineAbility, createAbilitySystem, AbilitySystemFacade, gameplay cues, and lockstep determinism.
metadata:
  author: phaeton2040-AI
  version: '1.0'
---

# Phalanx Abilities Skill

## When to Use This Skill

Use this skill when the user asks to:

- Add a gameplay ability system to a Phalanx ECS game
- Define attributes, buffs, debuffs, cooldowns, or costs
- Implement AoE, radius heals, or aura zones
- Wire abilities to **phalanx-physics** for spatial targeting
- Add activation hooks for projectiles, rockets, or spawned zones
- Implement channeling (beam on / beam off) with tag-driven effect removal
- Set up gameplay cues for VFX/SFX on the client `GameWorld`
- Debug non-deterministic combat or lockstep attribute desync

## Prerequisites

- TypeScript project with strict mode
- `phalanx-ecs` — `GameWorld`, `Entity`, `GameSystem`, `EventBus`, `resetEntityIdCounter`
- `phalanx-math` — `FP`, `FixedPoint` (all magnitudes and spatial values)
- **Optional** `phalanx-physics` — `PhysicsWorld` for `createAbilitySystem({ physicsWorld })` and radius/AoE
- Read [`phalanx-abilities/README.md`](../../phalanx-abilities/README.md) for full API detail

## Architecture Overview

```
GameWorld (phalanx-ecs)
├── createAbilitySystem(world, config)
│   ├── AbilitySystemRegistries   (per-world defs + spatialQuery)
│   ├── AbilitySystemRuntime      (activation FIFO, instance ids, GameplayCueBuffer)
│   ├── AbilitySystemFacade       (enqueue API)
│   └── tickSystems[]             → world.registerSystems([...abilities.tickSystems], [])
└── PhysicsWorld? (optional)      → physicsWorld config → ISpatialQuery adapter

Per tick (full pipeline):
  AbilityActivationSystem → EffectApplicationSystem → AbilityHookExecutorSystem
  → EffectTickSystem → AuraTickSystem → AttributeAggregationSystem
  → [CueDispatchSystem] → CueBufferCleanupSystem
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
import { PhysicsWorld } from 'phalanx-physics';

resetEntityIdCounter();
const world = new GameWorld({ tickRate: 20 });
const physicsWorld = new PhysicsWorld({ tickRate: 20 });

const abilities = createAbilitySystem(world, {
  definitions: combatDefs,
  physicsWorld,
  hooks: { 'Hook.SpawnProjectile': myHook },
  cues: 'dispatch',
});

world.registerSystems(
  [...abilities.tickSystems, physicsWorld.getSystems().physicsSystem],
  []
);
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

### 5. Optional: gameplay cue listeners

```typescript
import { GAMEPLAY_CUE_EVENT, type GameplayCueDispatchedEvent } from 'phalanx-abilities';

world.eventBus.on<GameplayCueDispatchedEvent>(GAMEPLAY_CUE_EVENT, (e) => {
  // Presentation only — never applyEffect / activateAbility here
});
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
| AoE at caster | `{ kind: 'Radius', origin: { kind: 'Caster' }, radius }` + `physicsWorld` |
| AoE at point | `applyEffectAoE({ x, z }, effectId, sourceId, { radius })` |

### Hook vs targetEffectIds

| Pattern | Use |
|---------|-----|
| Damage/buff applied directly to resolved targets | `targetEffectIds` |
| Spawn projectile/rocket/aura entity | `hookId` + `registerHook` / `hooks` config |
| Hit damage after projectile travels | Hook spawns entity; **on hit** call `applyEffect` (not `targetEffectIds`) |

### Aura vs one-shot AoE

| Pattern | Use |
|---------|-----|
| Explosion at one instant | `applyEffectAoE` on impact |
| Heal/damage in area every N ticks | `spawnAura` with `periodTicks` and Instant `effectIds` |

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

### Healing aura

```typescript
// Hook after Self-target activation:
abilities.spawnAura({
  abilityId: 'Ability.HealingAura',
  target: {
    kind: 'Radius',
    origin: { kind: 'TargetEntity', entityId: zone.id },
    radius: FP.FromInt(8),
    filter: { tagsRequired: ['Team.Ally'] },
    includeSelf: true,
  },
  effectIds: ['Effect.Heal'],
  periodTicks: 60,
  ownerEntityId: ctx.casterEntityId,
  lifetimeEffectId: 'Effect.HealingAura.Lifetime',
  lifetimeTag: 'Aura.HealingAura.Active',
});
```

Ensure zone position is visible to `ISpatialQuery` (physics grid or custom adapter).

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

### Rocket AoE

```typescript
abilities.applyEffectAoE(
  { x: hitX, z: hitZ },
  'Effect.Explosion',
  casterId,
  { radius: FP.FromInt(6), maxTargets: 8, includeSelf: false, selfId: casterId }
);
```

## phalanx-ecs integration

- Register `abilities.tickSystems` with other tick systems in **fixed order** (typically: input/commands → abilities activation → movement → physics → game reactions)
- Use `resetEntityIdCounter()` at match start before spawning entities
- Subscribe to `ABILITY_ACTIVATED_EVENT` for UI feedback; do not rely on synchronous `activateAbility` return value for success
- Attach `AbilitySystemComponent` via `abilities.initComponent()` rather than low-level attribute/tag components unless testing internals
- `GameplayCueBuffer` is world-scoped runtime — not an `IComponent`

## phalanx-physics integration

```typescript
import { PhysicsWorld } from 'phalanx-physics';
import { createAbilitySystem } from 'phalanx-abilities';

const physicsWorld = new PhysicsWorld({ tickRate: 20 });

const abilities = createAbilitySystem(world, {
  definitions: combatDefs,
  physicsWorld,
});

// Link transform store on tick 0 (see phalanx-physics skill), then:
world.registerSystems(
  [movementSystem, ...abilities.tickSystems, physicsWorld.getSystems().physicsSystem],
  frameSystems
);
```

Manual adapter (equivalent):

```typescript
import { createPhysicsSpatialQuery } from 'phalanx-physics';
import { spatialQueryFromPhysicsWorld } from 'phalanx-abilities';

// Either works; prefer physicsWorld config on createAbilitySystem.
```

`spatialQuery` in config **overrides** `physicsWorld`.

## Determinism Rules

- All modifier magnitudes: `FP.FromInt` / `FP.FromFloat` — never raw `number` in defs
- Durations: integer `durationTicks` / `periodTicks`, not seconds
- AoE: targets sorted by entity id ASC; `maxTargets` after sort; FP squared distance
- No `Math.random`, `Date.now`, or native float math in hooks or custom `ISpatialQuery`
- `activateAbility` snapshots `providedTarget` — do not mutate the object after the call
- `applyEffect` source default: `NO_SOURCE_ENTITY_ID` (`-1`) when omitted
- Effect removal via `removeEffectsByTag` flags `remainingTicks = 0`; processed next `EffectTickSystem` pass
- Two peers must register identical definitions before any entity spawns

## Anti-Patterns

| Anti-pattern | Why |
|--------------|-----|
| Expect `activateAbility` === success | Only means queued; listen to `ABILITY_ACTIVATED_EVENT` |
| Read `current` attribute immediately after `applyEffect` | Wait for tick systems + aggregation |
| `Math.sqrt` for AoE range | Use squared FP distance in custom queries |
| Non-Instant effects in `spawnAura` effectIds | Stacks unbounded each period |
| `applyEffect` from cue listeners | Breaks determinism; use command/input systems |
| Global attribute/effect registries | Registries are per `createAbilitySystem` / world |
| Mutate `GameplayTagsComponent.tags` directly | Use `addTag` / effects / `removeEffectsByTag` |
| Skip `physicsWorld` for `Radius` abilities | Throws at resolve time |
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
  AuraComponent,
  AbilitiesComponentType,
} from 'phalanx-abilities';

// Events
import {
  ABILITY_ACTIVATED_EVENT,
  type AbilityActivatedEvent,
  GAMEPLAY_CUE_EVENT,
  gameplayCueKey,
  type GameplayCueDispatchedEvent,
} from 'phalanx-abilities';

// Spatial
import {
  type ISpatialQuery,
  spatialQueryFromPhysicsWorld,
  type PhysicsWorldSpatialQuery,
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
  AuraTickSystem,
  AttributeAggregationSystem,
  AbilityHookExecutorSystem,
  CueDispatchSystem,
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
  pipeline: 'activation', // or 'effects', 'auras', 'full'
});
world.registerSystems([...abilities.tickSystems], []);
world.processAllTicks(2);
```

Use `pipeline: 'effects-retain-cues'` to assert on `abilities.gameplayCueBuffer` before cleanup.

See `phalanx-abilities/tests/helpers.ts` for `FakeSpatialQuery` when physics is not required.

## Related skills

- `phalanx-ecs` — GameWorld, entities, systems, lockstep
- `phalanx-physics` — PhysicsWorld, spatial grid, transform linking
- `phalanx-math` — fixed-point arithmetic (use with all ability magnitudes)
