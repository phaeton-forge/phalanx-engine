# Phalanx Abilities

A deterministic gameplay ability system (GAS-inspired) for the [Phalanx Engine](../README.md). Built for lockstep multiplayer: attributes, effects, tags, abilities, targeting, auras, and gameplay cues all run on fixed-point math and tick-aligned ECS systems.

> Sibling packages: [phalanx-ecs](../phalanx-ecs/README.md) (ECS core), [phalanx-math](../phalanx-math/README.md) (fixed-point math), [phalanx-physics](../phalanx-physics/README.md) (optional spatial queries for AoE).

## Features

- **Attributes**: `base` + `current`, per-definition `min`/`max`, FIFO modifier aggregation (`Add` / `Multiply` / `Override`), clamping
- **Gameplay effects**: `Instant`, `Duration`, `Periodic` with tick-based `durationTicks` / `periodTicks`
- **Gameplay tags**: hierarchical strings (`State.Buff.Speed`), `tagsRequired` / `tagsBlocked` / `tagsGranted` on effects and abilities
- **Abilities**: declarative definitions, activation queue, cost/cooldown via effects, `CanActivate` checks
- **Targeting**: `Self`, `Entity`, `Point`, `Radius` with deterministic resolve (sorted by entity id, FP distance)
- **Auras**: persistent zone entities that re-resolve targets every `periodTicks`
- **Activation hooks**: deterministic callbacks for projectiles, rockets, aura spawn (user-owned entities)
- **Gameplay cues**: per-tick buffer → optional `EventBus` dispatch for VFX/SFX/UI (client simulation worlds)
- **Physics integration**: optional `physicsWorld` in `createAbilitySystem` — no hard peer dependency on `phalanx-physics`

### MVP scope

Included in v0.1: flat modifiers, channeling via `Duration` + `removeEffectsByTag`, `applyEffectAoE`, hooks, auras.

Planned for v2: execution calculations, granted abilities, stacking rules, `Box`/`Cone` targets, line-of-sight raycast, SoA attribute storage.

## Installation

> Not on npm yet — clone the monorepo and build via pnpm.

```bash
git clone https://github.com/phaeton2040-AI/phalanx-engine.git
cd phalanx-engine
pnpm install
pnpm --filter phalanx-abilities build
```

**Peer dependencies:** `phalanx-ecs` ^0.1.0, `phalanx-math` ^0.1.0

**Optional:** `phalanx-physics` for radius targeting and AoE (wired through `ISpatialQuery` / `physicsWorld` config).

## Quick start

This example wires **phalanx-ecs** (`GameWorld`), **phalanx-math** (`FP`), and optionally **phalanx-physics** (`PhysicsWorld`) into one abilities pipeline.

```typescript
import { Entity, GameWorld, resetEntityIdCounter } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import {
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  GAMEPLAY_CUE_EVENT,
  type GameplayCueDispatchedEvent,
} from 'phalanx-abilities';
import { PhysicsWorld } from 'phalanx-physics';

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
const physicsWorld = new PhysicsWorld({ tickRate: 20 });

// 2. Create the ability system and register tick systems on the world.
const abilities = createAbilitySystem(world, {
  definitions: combatDefinitions,
  physicsWorld, // wraps spatialGrid + getEntityPosition — no manual ISpatialQuery
  cues: 'dispatch', // mirror cues to world.eventBus (client worlds)
});

world.registerSystems(
  [
    ...abilities.tickSystems,
    ...physicsWorld.getSystems().physicsSystem,
  ],
  []
);

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
world.eventBus.on<GameplayCueDispatchedEvent>(GAMEPLAY_CUE_EVENT, (e) => {
  // VFX/SFX only — do not mutate gameplay state here.
  console.log(e.cueId, e.phase, e.targetEntityId);
});

abilities.activateAbility(hero.id, 'Ability.Fireball', { entityId: enemyId });
world.processAllTicks(currentTick);
```

**Tick discipline:** `activateAbility`, `applyEffect`, and `applyEffectAoE` enqueue work. Observable changes (attributes, tags, active effects) apply when ability **tick systems** run inside `world.processAllTicks()` (or your lockstep `beforeTick`/`afterTick` pipeline). Never expect synchronous attribute updates in the same call stack as the facade.

## Architecture

```
createAbilitySystem(world, config)
├── AbilitySystemRegistries     (per-world: attributes, effects, abilities, hooks, spatialQuery)
├── AbilitySystemRuntime        (activation queue, instance ids, GameplayCueBuffer)
├── AbilitySystemFacade         (applyEffect, activateAbility, spawnAura, …)
└── tickSystems[]               (registered on GameWorld)

Per simulation tick (client GameWorld):
  AbilityActivationSystem       → CanActivate, cost/cooldown/self effects
  EffectApplicationSystem       → pendingAdd, Instant/Duration/Periodic, tags, OnApplied cues
  AbilityHookExecutorSystem     → hookId callbacks (projectiles, aura spawn)
  EffectTickSystem              → duration countdown, Periodic ticks, OnExpired cues
  AuraTickSystem                → periodic re-resolve + Instant effects
  AttributeAggregationSystem    → FIFO modifiers + clamp → current
  CueDispatchSystem?            → buffer → EventBus (when cues: 'dispatch')
  CueBufferCleanupSystem        → clear buffer end of tick
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
  Add      → acc = acc + magnitude
  Multiply → acc = acc * magnitude
  Override → acc = magnitude
current = clamp(acc) per AttributeDef
```

### Effects

| Type | Behavior |
|------|----------|
| `Instant` | Modifies `base` immediately when applied |
| `Duration` | Stays in `ActiveEffectsComponent.queue` for `durationTicks`; grants tags while active |
| `Periodic` | Duration + fires modifiers every `periodTicks`; optional `executePeriodicOnApplication` |

Durations and periods are **whole simulation ticks** (`number`), compared to `runtime.currentTick` — not `FixedPoint` values.

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
  | { kind: 'Point'; origin: TargetOrigin }
  | {
      kind: 'Radius';
      origin: TargetOrigin;
      radius: FixedPoint;
      maxTargets?: number;
      filter?: TargetFilter;
      includeSelf?: boolean;
    };

type TargetOrigin =
  | { kind: 'Caster' }
  | { kind: 'TargetEntity'; entityId: number }
  | { kind: 'Point'; x: FixedPoint; z: FixedPoint }
  | { kind: 'Caller' }; // reads activateAbility(..., providedTarget)
```

`Radius` requires `ISpatialQuery` (via `physicsWorld` or `spatialQuery` config).

### Auras

`abilities.spawnAura` creates a zone `Entity` with `AuraComponent`. Every `periodTicks` the system re-resolves `target` and applies **Instant** `effectIds` to each hit. Lifetime is usually a `Duration` effect on the zone granting `lifetimeTag`; when the tag disappears, the zone is removed.

Aura effects must be `Instant` — `Duration`/`Periodic` would stack unbounded if re-applied every period.

### Activation hooks

Register in `createAbilitySystem({ hooks: { ... } })` or `facade.registerHook`. Hooks run **after** cost/cooldown/self effects on the activation tick. Use for spawning projectiles/rockets (entities live in **your** game code, not in this package).

```typescript
import type { AbilityHook } from 'phalanx-abilities';

const spawnProjectile: AbilityHook = (ctx) => {
  // ctx.abilityId, ctx.casterEntityId, ctx.resolvedTargets, ctx.providedTarget, ctx.tick
  // Spawn projectile entity; on hit call abilities.applyEffect(targetId, 'Effect.Damage', casterId)
};
```

### Spatial queries (phalanx-physics)

`phalanx-physics` is not a peer dependency. The adapter surface is:

```typescript
// phalanx-abilities (built-in when you pass physicsWorld)
import { spatialQueryFromPhysicsWorld } from 'phalanx-abilities';

// phalanx-physics (same behavior, typed PhysicsWorld)
import { createPhysicsSpatialQuery } from 'phalanx-physics';

createAbilitySystem(world, { physicsWorld: myPhysicsWorld });
// or
facade.registerSpatialQuery(createPhysicsSpatialQuery(myPhysicsWorld));
```

`PhysicsWorld.spatialGrid.queryRadius` and `getEntityPosition` must reflect the same positions your simulation uses for lockstep.

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

### 2. Healing aura

```typescript
defineEffect({
  id: 'Effect.Heal',
  type: 'Instant',
  modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(5) }],
});
defineEffect({
  id: 'Effect.HealingAura.Lifetime',
  type: 'Duration',
  durationTicks: 600,
  tagsGranted: ['Aura.HealingAura.Active'],
});
defineAbility({
  id: 'Ability.HealingAura',
  target: { kind: 'Self' },
  hookId: 'Hook.SpawnAura.Healing',
});

// In hook: abilities.spawnAura({
//   abilityId: 'Ability.HealingAura',
//   target: {
//     kind: 'Radius',
//     origin: { kind: 'TargetEntity', entityId: zone.id },
//     radius: FP.FromInt(8),
//     filter: { tagsRequired: ['Team.Ally'] },
//     includeSelf: true,
//   },
//   effectIds: ['Effect.Heal'],
//   periodTicks: 60,
//   ownerEntityId: ctx.casterEntityId,
//   lifetimeEffectId: 'Effect.HealingAura.Lifetime',
//   lifetimeTag: 'Aura.HealingAura.Active',
// });
```

Register the zone entity’s position with your spatial backend (physics grid or custom `ISpatialQuery`).

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

This is an intentional MVP limitation — v2 may add execution calculations.

### 5. Rocket AoE (explosion on impact)

```typescript
defineEffect({
  id: 'Effect.Explosion',
  type: 'Instant',
  modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-50) }],
  cues: ['Cue.Explosion.Hit'],
});
defineAbility({
  id: 'Ability.Rocket',
  cooldownEffectId: 'Effect.Rocket.Cooldown',
  target: { kind: 'Point', origin: { kind: 'Caller' } },
  hookId: 'Hook.SpawnProjectile.Rocket',
});

// On impact:
const hitIds = abilities.applyEffectAoE(
  { x: impactX, z: impactZ },
  'Effect.Explosion',
  casterId,
  {
    radius: FP.FromInt(6),
    maxTargets: 8,
    filter: { tagsBlocked: ['Team.Ally'] },
    includeSelf: false,
    selfId: casterId,
  }
);
```

## Gameplay cues

Cues are deterministic simulation-side notifications for local presentation (VFX, SFX, UI). They are **not** networked.

Pipeline:

```text
simulation systems → GameplayCueBuffer → CueDispatchSystem → local EventBus → CueBufferCleanupSystem
```

`GameplayCueBuffer` lives on `AbilitySystemRuntime`, not on entities.

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

Listener example (phalanx-ecs `EventBus`):

```typescript
import { GAMEPLAY_CUE_EVENT, type GameplayCueDispatchedEvent } from 'phalanx-abilities';

world.eventBus.on<GameplayCueDispatchedEvent>(GAMEPLAY_CUE_EVENT, (event) => {
  // Do not call applyEffect / activateAbility here.
  playVfx(event.cueId, event.targetEntityId);
});
```

Enable dispatch with `createAbilitySystem(world, { cues: 'dispatch' })`. Headless worlds can omit `CueDispatchSystem` but should still run `CueBufferCleanupSystem` if anything writes to the buffer.

## Determinism rules

- Use `FP.*` from `phalanx-math` for all modifier magnitudes and spatial math
- Store durations as integer **ticks**, not floats or `Date.now`
- AoE: `queryRadius` results are sorted by **entity id ASC**, then `maxTargets` truncates, then tag filters apply
- Distance checks use `dx*dx + dz*dz <= r*r` in fixed-point — no `Math.sqrt`
- Target lists are snapshotted at resolve time; late movement does not change who was hit
- Call `resetEntityIdCounter()` from `phalanx-ecs` at match start so aura/projectile spawns get identical ids on every peer
- Hooks must be pure deterministic simulation — no `Math.random()` or wall-clock time

## API reference

### Factory

```typescript
createAbilitySystem(world: GameWorld, config: CreateAbilitySystemConfig): AbilitySystem
```

| Config field | Purpose |
|--------------|---------|
| `definitions` | `defineAbilitySystem({ attributes, effects?, abilities? })` |
| `physicsWorld` | Auto-register `ISpatialQuery` from `PhysicsWorld` |
| `spatialQuery` | Custom query; overrides `physicsWorld` |
| `hooks` | `Record<hookId, AbilityHook>` |
| `pipeline` | `'full'` (default), `'activation'`, `'effects'`, `'attributes'`, `'auras'`, … |
| `cues` | `'buffer'` (default) or `'dispatch'` |

### `AbilitySystem` (returned by factory)

| Method | Description |
|--------|-------------|
| `initComponent(init?)` | Create `AbilitySystemComponent` with optional seed data |
| `activateAbility(casterId, abilityId, providedTarget?)` | Queue activation |
| `applyEffect(targetId, effectId, sourceId?)` | Queue effect (`sourceId` defaults to `-1`) |
| `applyEffectAoE(origin, effectId, sourceId, { radius, … })` | Radius resolve + queue; returns applied entity ids |
| `getAttribute` / `tryGetAttribute` | Read base/current |
| `hasTag` / `addTag` / `removeTag` | Tag queries and ad-hoc tags |
| `removeEffectsByTag` / `removeEffectsByDefId` | Flag instances for removal next tick |
| `spawnAura` / `setAuraActive` | Aura zones |
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
  GAMEPLAY_CUE_EVENT,
  gameplayCueKey,
  type GameplayCueDispatchedEvent,
} from 'phalanx-abilities';
```

### Components and types

Exported: `AbilitySystemComponent`, `AuraComponent`, `AbilitiesComponentType`, effect/attribute/tag types, `ISpatialQuery`, `spatialQueryFromPhysicsWorld`, individual systems for custom pipelines.

See `src/index.ts` for the full public surface.

## Integration checklist

1. **phalanx-ecs**: `GameWorld`, `Entity`, `resetEntityIdCounter`, register `abilities.tickSystems` in deterministic order alongside movement/physics/combat systems.
2. **phalanx-math**: `FP.FromInt`, `FP.FromFloat`, `FP.Add`, `FP.Mul`, etc. for all magnitudes.
3. **phalanx-physics** (if using AoE): create `PhysicsWorld`, link transform store on tick 0, pass `physicsWorld` into `createAbilitySystem`, run `physicsSystem` in the same tick loop.
4. **Client-only cues**: `cues: 'dispatch'` and subscribe on `world.eventBus`; never mutate simulation from cue handlers.
5. **User-owned systems**: projectiles, rockets, and damage formulas that read `IncomingDamageMultiplier` stay in game code; call `applyEffect` / `applyEffectAoE` on deterministic events (collision, impact tick).

## Testing

```bash
pnpm --filter phalanx-abilities test
```

Tests use `GameWorld.processAllTicks()` with pipeline subsets (`activation`, `effects`, `auras`, …) and a `FakeSpatialQuery` when physics is not needed. See `tests/helpers.ts` for patterns.

## Agent skill

For AI-assisted development, use the repository skill:

[`skills/phalanx-abilities/SKILL.md`](../skills/phalanx-abilities/SKILL.md)

It covers decision trees, the five recipes above, determinism rules, and anti-patterns when extending combat systems.

## License

Same as the Phalanx Engine monorepo.
