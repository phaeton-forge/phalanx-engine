# phalanx-abilities

Deterministic gameplay ability system for Phalanx Engine.

## Gameplay Cues

Gameplay cues are deterministic simulation-side notifications intended for local, non-authoritative presentation work such as VFX, SFX, UI, logs, and debug overlays.

The client-world cue pipeline is:

```text
simulation systems → GameplayCueBuffer → CueDispatchSystem → local EventBus → CueBufferCleanupSystem
```

`GameplayCueBuffer` is runtime state on `AbilitySystemRuntime`; it is not an ECS component and does not belong to an entity. Simulation systems append cue events in deterministic order, then client worlds may mirror those events to the local `EventBus`.

Effects can declare cues in either structured form or a shortcut array:

```ts
defineEffect({
  id: 'Effect.AutoAttack.Damage',
  type: 'Instant',
  cues: ['Cue.AutoAttack.Hit'], // shortcut for OnApplied
});

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

`cues: ['Cue.X']` is equivalent to `cues: { onApplied: ['Cue.X'] }`. It does not emit `OnPeriodic` or `OnExpired` cues.

Client worlds that want local cue listeners should register systems in this order near the end of the abilities pipeline:

```text
EffectApplicationSystem
AbilityHookExecutorSystem
EffectTickSystem
AttributeAggregationSystem
CueDispatchSystem
CueBufferCleanupSystem
```

`CueDispatchSystem` emits each cue twice:

- `GAMEPLAY_CUE_EVENT` for global listeners;
- `gameplayCueKey(cueId)` for listeners interested in one cue id.

Example listener:

```ts
import {
  GAMEPLAY_CUE_EVENT,
  type GameplayCueDispatchedEvent,
} from 'phalanx-abilities';

world.eventBus.on<GameplayCueDispatchedEvent>(GAMEPLAY_CUE_EVENT, (event) => {
  // VFX/SFX/UI only. Do not mutate deterministic gameplay state here.
  console.log(event.cueId, event.phase);
});
```

Listener rules:

- Treat cue listeners as local presentation code only.
- Do not write directly to gameplay components such as attributes, active effects, or gameplay tags.
- Do not call `applyEffect` or `activateAbility` from cue listeners; enqueue deterministic gameplay work from input/command systems instead.
- Keep server/headless worlds free of `CueDispatchSystem`. If a world uses the cue buffer without dispatch, still register `CueBufferCleanupSystem` last so events do not leak across ticks.
