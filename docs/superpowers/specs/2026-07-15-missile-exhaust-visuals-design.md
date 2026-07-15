# Missile Exhaust Visuals Design

**Date:** 2026-07-15  
**Scope:** `abilities-playground` (Three.js presentation only)  
**Status:** Approved for planning

## Goal

Make missiles look like they have a real soft engine exhaust: a warm nozzle glow plus lingering smoke trails. Visual only — smoke trails are intentionally non-deterministic and must not affect simulation or replay.

## Choices locked in

| Topic | Choice |
| --- | --- |
| Look | Soft realistic (warm orange/white core, subtle glow, gray drifting smoke) |
| Smoke linger | Medium (~1.5–2.5s after particles spawn) |
| Architecture | Cue-based VFX (`MissileExhaustCue`), plus mesh nozzle upgrade |

## Non-goals

- No changes to missile movement, damage, pooling identity, or FP math
- No deterministic particle seeds / replay-stable smoke
- No Babylon / arena-shooter trail port
- No changes to impact cue look (existing `Cue.Missile.Impact` stays)

## Architecture

Two presentation pieces:

1. **Mesh glow** — upgrade `MeshComponent.createMissile()` nozzle geometry/light.
2. **`MissileExhaustCue`** — long-lived gameplay cue (same lifecycle pattern as `BeamCue`): follows the missile, emits/ages smoke, soft-flickers the nozzle, finishes after the missile is gone and smoke has faded.

```text
missile spawn
  -> buffer Cue.Missile.Exhaust (sourceEntityId = missile.id)
  -> CueDispatch spawns MissileExhaustCue
  -> each frame: sample nozzle, emit smoke, flicker glow
missile soft-deactivate / despawn
  -> stop emitting
  -> age remaining particles (~1.5–2.5s)
  -> isFinished() -> dispose Points resources
```

Determinism boundary: all `Math.random` (and similar) lives only in cue/mesh presentation code. Simulation systems and FP paths stay untouched.

## Components

### Engine glow (`MeshComponent.createMissile`)

- Keep the metal body cylinder as-is.
- Replace the single orange cone with a soft nozzle stack:
  - small bright near-white core cone
  - larger warm-orange outer cone
  - both: transparent, additive blending, `depthWrite: false`
- Attach a low-intensity, short-range warm `PointLight` at the nozzle.
- Store refs on the group `userData` for cue access:
  - `flameCore`, `flameOuter`, `engineLight`
- Cue may pulse opacity / light intensity; cue must not dispose these mesh-owned objects.

### Smoke (`MissileExhaustCue`)

- Extends `Cue` from `@phalanx-engine/abilities`.
- Owns a fixed-capacity `THREE.Points` buffer (reuse dead slots).
- Soft gray particles, normal (non-additive) blending, size attenuation, transparent, `depthWrite: false`.
- While missile is active and resolvable:
  - sample nozzle world position from mesh `userData` / mesh root (fallback: transform position)
  - spawn a few particles per frame with small random offset, slight upward drift, lifetime in ~1.5–2.5s
- Age particles each frame: slight growth, opacity fade, recycle when dead.
- Soft flicker: subtle sine/random pulse on flame opacity and `PointLight` intensity.
- Finish when: missile inactive/missing **and** no live smoke particles remain.
- `dispose()` removes Points from the scene and disposes geometry/material only.

### Wiring

- Register factory: `'Cue.Missile.Exhaust': () => new MissileExhaustCue(scene)` in `SimulationContainer`.
- Export from `abilities-playground/src/cues/index.ts`.
- Buffer the cue when each missile is spawned (volley / launcher spawn path), mirroring `bufferMissileImpactCue`:
  - `cueId: 'Cue.Missile.Exhaust'`
  - `sourceEntityId` / `targetEntityId`: missile entity id
  - `phase: 'OnApplied'`
- Prefer buffering at the spawn site that already knows the new missile id (hook/launcher), so the exhaust starts with flight rather than only at impact.

## Lifecycle & edge cases

| Case | Behavior |
| --- | --- |
| Normal flight | Emit + flicker while missile `active` and mesh/transform resolvable |
| Soft-deactivate / impact | Stop emitting; keep fading smoke until empty |
| Entity missing on spawn | Mark finished immediately (same spirit as impact cue with no point) |
| Pooled respawn | Each spawn buffers a **new** cue. Finished cues must not follow a recycled entity id |
| Volleys | One cue instance per missile; fixed particle capacity bounds cost |
| Cue dispose | Never dispose missile mesh flame/light — owned by `MeshComponent` |

## Testing

- No unit assertions on particle positions (non-deterministic by design).
- Existing missile / quaternion / movement tests must remain green (sim path unchanged).
- Manual verification in abilities-playground:
  - nozzle reads as soft realistic glow
  - smoke trails linger ~1.5–2.5s
  - impact cue still plays
  - no leftover `THREE.Points` after missiles clear / battle reset

## Files likely touched

- `abilities-playground/src/components/UnitComponents.ts` — `createMissile` glow upgrade
- `abilities-playground/src/cues/missileExhaustCue.ts` — new cue (name may match repo style)
- `abilities-playground/src/cues/index.ts` — export
- `abilities-playground/src/core/SimulationContainer.ts` — register cue factory
- Missile spawn path (`MissileVolley` and/or launcher/movement buffer helper) — buffer exhaust cue on spawn

## Success criteria

- Missiles show a soft engine glow during flight.
- Missiles leave non-deterministic gray smoke trails that linger ~1.5–2.5s.
- Simulation determinism and existing missile behavior are unchanged.
- Exhaust VFX cleans up fully when missiles despawn and after smoke fade-out.
