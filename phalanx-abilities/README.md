# @phalanx-engine/abilities

A gameplay-ability system for Phalanx, in the spirit of Unreal GAS.
Attributes, effects, tags, and abilities run on fixed-point math and on
integer tick counts, so a buff that lasts 30 ticks lasts 30 ticks on
every machine.

```bash
pnpm add @phalanx-engine/abilities
```

Peers: `@phalanx-engine/ecs`, `@phalanx-engine/math`. Games import this
package through `@phalanx-engine/game/abilities`.

## Quick start

`createAbilitySystem(world, config)` wires the world. Call it before
`world.start()`.

It registers four components — `AbilityOwner`, `Attributes`,
`ActiveEffects`, `GameplayTags` — provides the `Abilities` service, adds
the simulation pipeline to the `abilities` phase, adds
`CuePresentationSystem` to the `present` frame phase when you pass cues,
and registers save section `abilities` (version 1).

```ts
import { GameWorld, type ITickFrameProvider } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  AbilityOwner,
  abilityOwnerOf,
  attributesOf,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
} from '@phalanx-engine/abilities';

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
  effects: [
    defineEffect({
      id: 'Effect.Fireball',
      type: 'Instant',
      modifiers: [
        { attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-25) },
      ],
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
      cooldownEffectId: 'Effect.Fireball.Cooldown',
      activationBlockedTags: ['Cooldown.Ability.Fireball', 'State.Stun'],
      target: { kind: 'Entity', origin: { kind: 'Caller' } },
      targetEffectIds: ['Effect.Fireball'],
    }),
  ],
});

const tickFrameProvider: ITickFrameProvider = {
  onTick: () => () => {},
  onFrame: () => () => {},
};
const world = new GameWorld({ tickFrameProvider });
const abilities = createAbilitySystem(world, { definitions });

const hero = world.createEntity();
world.addComponent(hero, AbilityOwner, {
  attributes: { Health: FP.FromInt(100) },
  abilities: ['Ability.Fireball'],
  tags: ['Team.Hero'],
});

const enemyId = 2;
abilities.activateAbility(hero.id, 'Ability.Fireball', {
  entityId: enemyId,
});
world.processAllTicks(1);

abilityOwnerOf(hero);
attributesOf(hero);
```

`activateAbility` and `applyEffect` enqueue work. Attributes, tags, and
the effect queue change when the ability systems run inside the tick.
The return value of `activateAbility` means **queued**. Listen for
`ABILITY_ACTIVATED_EVENT` for the real outcome.

A standalone attribute bag, sized to the registry:

```ts
world.addComponent(hero, Attributes, { Health: FP.FromInt(80) });
```

`world.addComponent(entity, AbilityOwner, init)` attaches all four
components and throws when one of them is already present.
`world.removeComponent(entity, AbilityOwner)` removes all four. Removing
`Attributes`, `ActiveEffects`, or `GameplayTags` while the owner is
attached throws.

## Reading and querying

```ts
import {
  ActiveEffects,
  Attributes,
  activeEffectsOf,
  attributesOf,
  gameplayTagsOf,
} from '@phalanx-engine/abilities';

const owner = abilityOwnerOf(hero);
const attrs = attributesOf(hero);
const effects = activeEffectsOf(hero);
const tags = gameplayTagsOf(hero);

for (const [entity, active] of world.query(ActiveEffects)) {
  active.queue;
}

for (const [entity, attrs, active] of world.queryAny(
  Attributes,
  ActiveEffects
)) {
  attrs?.current;
  active?.queue;
}
```

Each reader is one component lookup. Test presence with
`entity.hasComponent(Attributes.type)`. Do not mutate
`gameplayTagsOf(entity).tags`. Use `addTag`, an effect's `tagsGranted`,
or `removeEffectsByTag`.

Systems reach the facade with `this.context.getService(Abilities)`.

Put movement in `input`. Reactions that need this tick's ability results
go in `late`. The ability systems own the `abilities` phase. Their order
is activation, effect application, hooks, effect tick, attribute
aggregation, cue dispatch, cue cleanup. Leave that order alone.

Registries are per world. Every peer registers the same definitions
before the first entity spawns, or attribute indices diverge.

## Attributes, effects, abilities

Aggregation walks active modifiers in ascending `instanceId`:

```
acc = base
Add      → acc = acc + magnitude
Multiply → acc = acc * magnitude
Override → acc = magnitude
current = clamp(acc)
```

| Effect     | Behaviour                                                  |
| ---------- | ---------------------------------------------------------- |
| `Instant`  | Writes `base` when it is applied                           |
| `Duration` | Stays for `durationTicks` and grants its tags while active |
| `Periodic` | A duration that also fires every `periodTicks`             |

Durations are whole ticks, compared with the runtime tick. They are not
fixed-point and they are not milliseconds.

Tags are dot-namespaced PascalCase: `Team.Red`,
`Cooldown.Ability.Fireball`, `State.Debuff.ArmorShred`. Effect-granted
tags leave when the effect expires or `removeEffectsByTag` strips it.
`addTag` / `removeTag` are for spawn-time facts such as team.

```ts
type TargetSpec =
  | { kind: 'Self' }
  | { kind: 'Entity'; origin: TargetOrigin }
  | { kind: 'Point'; origin: TargetOrigin };
```

`Caller` reads the `providedTarget` passed to `activateAbility`. That
object is snapshotted. Do not mutate it afterwards. The resolved target
does not follow a unit that moves later in the tick.

Hooks run after cost, cooldown, and self effects. Register them on
`createAbilitySystem({ hooks })`. Projectiles live in game code. On a
hit, call `applyEffect`.

AoE is the same idea: query targets in a game system, then
`applyEffect` each one.

## Dynamic magnitudes

A modifier may carry a `calculation`. It runs once, at application, and
the result is what Instant applies and what Duration and Periodic reuse
for their whole life. Later changes to the source do not rewrite it.

```ts
import type { MagnitudeCalculation } from '@phalanx-engine/abilities';
import { FP } from '@phalanx-engine/math';

const levelScaledDamage: MagnitudeCalculation = (ctx) => {
  const level = ctx.abilities.tryGetAttribute(
    ctx.sourceEntityId,
    'AbilityLevel'
  );
  if (!level) return ctx.baseMagnitude;
  const multiplier = FP.Add(
    FP.FromInt(1),
    FP.Mul(FP.FromFloat(0.5), FP.Sub(level.current, FP.FromInt(1)))
  );
  return FP.Mul(ctx.baseMagnitude, multiplier);
};
```

The callback is pure fixed-point. It may read `tryGetAttribute` and
`hasTag`. It must not apply effects, roll random numbers, or read a
clock. `tryGetAttribute` returns `undefined` when the entity or the
attribute is missing. Handle that. `setByCaller` is the optional map
passed as the fourth argument of `applyEffect`.

## Recipes

**Projectile attack.** The ability applies a cooldown. A hook spawns the
projectile. Damage is an Instant effect on impact.

```ts
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
});
defineAbility({
  id: 'Ability.AutoAttack',
  cooldownEffectId: 'Effect.AutoAttack.Cooldown',
  activationBlockedTags: ['Cooldown.Ability.AutoAttack', 'State.Stun'],
  target: { kind: 'Entity', origin: { kind: 'Caller' } },
  hookId: 'Hook.SpawnProjectile.AutoAttack',
});
```

**Regeneration.** A periodic effect on self.

```ts
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

**Channel.** A duration debuff, removed when the beam drops.

```ts
abilities.removeEffectsByTag(targetId, 'State.Debuff.ArmorShred');
```

**A mark the damage pipeline reads.** Store
`IncomingDamageMultiplier` on the target. Your damage code reads
`tryGetAttribute` before it applies the Instant. For a magnitude that
depends on the source at application time, prefer `calculation`.

## Cues

Cues are local presentation. They are not networked, and a cue must not
call `applyEffect` or `activateAbility`.

```ts
import {
  Cue,
  type CueContext,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';

class FireballHitCue extends Cue {
  private done = false;

  public onSpawn(_event: GameplayCueDispatchedEvent, _ctx: CueContext): void {
    this.done = false;
  }

  public override update(_dt: number): void {
    this.done = true;
  }

  public override isFinished(): boolean {
    return this.done;
  }
}

createAbilitySystem(world, {
  definitions,
  cues: { 'Cue.Fireball.Hit': () => new FireballHitCue() },
});
```

A non-empty `cues` map registers `CueDispatchSystem` and
`CuePresentationSystem` (`present`, driven from `afterFrame`). Omit
`cues` on a headless world. `CueBufferCleanupSystem` still clears the
buffer at the end of the tick. `pipeline: 'effects-retain-cues'` keeps
the buffer for tests.

Effects name cues as an array (on applied) or as
`{ onApplied, onPeriodic, onExpired }`.

## Factory

```ts
createAbilitySystem(world, {
  definitions, // defineAbilitySystem({ attributes, effects?, abilities? })
  hooks, // Record<hookId, AbilityHook>
  pipeline, // 'full' | 'activation' | 'effects' | 'effects-retain-cues' | 'attributes'
  cues, // cueId → () => Cue
}): AbilitySystem
```

| Method                                                     | Role                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `activateAbility(casterId, abilityId, providedTarget?)`    | Queue an activation                                                       |
| `applyEffect(targetId, effectId, sourceId?, setByCaller?)` | Queue an effect. `sourceId` defaults to `-1`                              |
| `getAttribute` / `tryGetAttribute`                         | Read base and current                                                     |
| `hasTag` / `addTag` / `removeTag`                          | Ad-hoc tags                                                               |
| `removeEffectsByTag` / `removeEffectsByDefId`              | Flag instances for removal next tick                                      |
| `exportRuntimeState` / `importRuntimeState`                | Instance counter, queue, tick, resolved activations. The cue buffer stays |
| `isAbilityRegistered` / `isEffectRegistered`               | Registry membership for this world                                        |

Pooled entities lose transient ability state when they return to the
pool. `createAbilitySystem` installs that reset. The first return
records the factory shell (attribute base, current, and dirty, the
equipped ability set, ad-hoc tags, and effect grants including
`AbilityOwner` init tags). Later returns copy that shell back and drop
GAS components attached during the life. `onEnable('restore')` does not
reseed, so a snapshot's pending list is kept.

## Determinism

- Magnitudes are `FixedPoint` (`FP.FromInt`, `FP.FromFloat`).
- Durations are integer ticks.
- Hooks are pure. No `Math.random`, no `Date.now`.
- Spawn projectiles with `world.createEntity` so ids match on every peer.
- Cues stay on the client. Do not register `CueDispatchSystem` on a
  server world.

## License

MIT
