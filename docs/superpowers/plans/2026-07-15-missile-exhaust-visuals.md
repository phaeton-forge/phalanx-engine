# Missile Exhaust Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give abilities-playground missiles a soft realistic engine glow and non-deterministic smoke trails via mesh upgrades plus a long-lived `MissileExhaustCue`.

**Architecture:** Upgrade `MeshComponent.createMissile()` with a layered nozzle + `PointLight` (refs on `group.userData`). Add `MissileExhaustCue` that follows the missile, emits/ages gray smoke particles, and soft-flickers the nozzle. Dispatch the cue from `missileVolley` on each spawn via `eventBus.emit(gameplayCueKey(...))` (same presentation path as `plasmaTankMachineGun` fire cue). Simulation / FP paths stay untouched.

**Tech Stack:** TypeScript, Three.js, `@phalanx-engine/abilities` Cue API, abilities-playground ECS

## Global Constraints

- Presentation only — no FP/sim/replay changes; smoke uses `Math.random` freely in cue code
- Soft realistic look; smoke particle lifetime ~1.5–2.5s
- Cue must not dispose mesh-owned flame/light objects
- Follow existing cue patterns (`BeamCue` lifecycle, `MissileImpactCue` Points style, `PlasmaTankMachineGun` hook dispatch)
- Work in `phalanx-engine` git root under `abilities-playground/`
- **No new automated tests.** This is visual VFX work; verify by running the playground and looking at missiles. Do not add Vitest files for this feature. Do not follow TDD for these tasks.

---

## File map

| File | Responsibility |
| --- | --- |
| `abilities-playground/src/components/UnitComponents.ts` | Soft nozzle glow + `userData` refs in `createMissile` |
| `abilities-playground/src/cues/missileExhaustCue.ts` | Long-lived exhaust cue (smoke + flicker) |
| `abilities-playground/src/cues/index.ts` | Export cue |
| `abilities-playground/src/core/SimulationContainer.ts` | Register `'Cue.Missile.Exhaust'` factory |
| `abilities-playground/src/hooks/MissileVolley.ts` | Dispatch exhaust cue per spawned missile |
| `abilities-playground/src/hooks/dispatchMissileExhaustCue.ts` | Small helper to emit the exhaust cue event |

---

### Task 1: Soft nozzle glow on missile mesh

**Files:**
- Modify: `abilities-playground/src/components/UnitComponents.ts` (`createMissile`, ~lines 212–243)

**Interfaces:**
- Consumes: existing `MeshComponent.createMissile(): MeshComponent`, `MeshComponent.initScene(scene)`
- Produces: `group.userData` shape used by Task 2:
  - `flameCore: THREE.Mesh`
  - `flameOuter: THREE.Mesh`
  - `engineLight: THREE.PointLight`
  - nozzle sample point is `flameCore` world position

- [ ] **Step 1: Implement soft nozzle in `createMissile`**

Replace the single-cone flame block in `MeshComponent.createMissile` with:

```typescript
public static createMissile(): MeshComponent {
  const group = new THREE.Group();

  const bodyLength = 2.0;
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.6, bodyLength, 12),
    new THREE.MeshStandardMaterial({
      color: 0xdddddd,
      metalness: 0.5,
      roughness: 0.35,
    }),
  );
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;

  const makeFlame = (
    radius: number,
    height: number,
    color: number,
    opacity: number,
  ): THREE.Mesh => {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(radius, height, 12),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -(bodyLength / 2 + height / 2);
    return flame;
  };

  // Soft realistic stack: hot core + warmer outer wash
  const flameCore = makeFlame(0.22, 0.7, 0xfff2cc, 0.95);
  const flameOuter = makeFlame(0.48, 1.15, 0xff8a2a, 0.55);

  const engineLight = new THREE.PointLight(0xffa040, 1.1, 5, 2);
  engineLight.position.z = -(bodyLength / 2 + 0.15);

  group.add(body);
  group.add(flameOuter);
  group.add(flameCore);
  group.add(engineLight);

  group.userData.flameCore = flameCore;
  group.userData.flameOuter = flameOuter;
  group.userData.engineLight = engineLight;

  group.visible = false;
  return new MeshComponent(group);
}
```

Keep body geometry/material otherwise unchanged.

- [ ] **Step 2: Typecheck**

Run from `abilities-playground`:

```bash
npx tsc --noEmit
```

Expected: no errors related to the missile mesh change.

- [ ] **Step 3: Commit**

```bash
git add abilities-playground/src/components/UnitComponents.ts
git commit -m "feat(missiles): add soft nozzle glow meshes and engine light"
```

---

### Task 2: `MissileExhaustCue` (smoke + flicker)

**Files:**
- Create: `abilities-playground/src/cues/missileExhaustCue.ts`
- Modify: `abilities-playground/src/cues/index.ts`
- Modify: `abilities-playground/src/core/SimulationContainer.ts` (cues map + import)

**Interfaces:**
- Consumes: `group.userData.flameCore|flameOuter|engineLight` from Task 1; `Cue` / `CueContext` / `GameplayCueDispatchedEvent` from `@phalanx-engine/abilities`; `ComponentType.Mesh`, `MeshComponent`, `TransformComponent`
- Produces: `export class MissileExhaustCue extends Cue` with constructor `(scene: THREE.Scene)`; cue id string `'Cue.Missile.Exhaust'` for Task 3

- [ ] **Step 1: Implement `MissileExhaustCue`**

Create `abilities-playground/src/cues/missileExhaustCue.ts`:

```typescript
import * as THREE from 'three';
import {
  Cue,
  type CueContext,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import type { Entity } from '@phalanx-engine/ecs';
import { FPVector3 } from '@phalanx-engine/math';
import type { TransformComponent } from '@phalanx-engine/physics';
import { ComponentType, MeshComponent } from '../components';

const PARTICLE_CAPACITY = 96;
const EMIT_PER_SECOND = 28;
const LIFE_MIN = 1.5;
const LIFE_MAX = 2.5;
const SMOKE_SIZE = 0.55;
const BASE_CORE_OPACITY = 0.95;
const BASE_OUTER_OPACITY = 0.55;
const BASE_LIGHT_INTENSITY = 1.1;

type ExhaustUserData = {
  flameCore?: THREE.Mesh;
  flameOuter?: THREE.Mesh;
  engineLight?: THREE.PointLight;
};

type MaybeActive = { active?: boolean };

export class MissileExhaustCue extends Cue {
  private readonly scene: THREE.Scene;
  private context: CueContext | null = null;
  private missileEntityId = -1;
  private emitting = true;
  private done = false;
  private emitAccumulator = 0;
  private elapsed = 0;

  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.PointsMaterial | null = null;
  private positions: Float32Array | null = null;
  private velocities: Float32Array | null = null;
  private ages: Float32Array | null = null;
  private lifetimes: Float32Array | null = null;
  private aliveCount = 0;

  private flameCore: THREE.Mesh | null = null;
  private flameOuter: THREE.Mesh | null = null;
  private engineLight: THREE.PointLight | null = null;
  private readonly nozzleWorld = new THREE.Vector3();

  public constructor(scene: THREE.Scene) {
    super();
    this.scene = scene;
  }

  public onSpawn(event: GameplayCueDispatchedEvent, context: CueContext): void {
    this.context = context;
    this.missileEntityId = event.sourceEntityId;

    const entity = context.entityManager.getEntity(this.missileEntityId);
    if (!entity) {
      this.done = true;
      return;
    }

    const mesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
    if (!mesh) {
      this.done = true;
      return;
    }

    const data = mesh.root.userData as ExhaustUserData;
    this.flameCore = data.flameCore ?? null;
    this.flameOuter = data.flameOuter ?? null;
    this.engineLight = data.engineLight ?? null;

    this.positions = new Float32Array(PARTICLE_CAPACITY * 3);
    this.velocities = new Float32Array(PARTICLE_CAPACITY * 3);
    this.ages = new Float32Array(PARTICLE_CAPACITY);
    this.lifetimes = new Float32Array(PARTICLE_CAPACITY);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.PointsMaterial({
      color: new THREE.Color('#9a9a9a'),
      size: SMOKE_SIZE,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8500;
    this.scene.add(this.points);
  }

  public override update(deltaTimeSeconds: number): void {
    if (this.done || !this.context) return;

    this.elapsed += deltaTimeSeconds;
    const entity = this.context.entityManager.getEntity(this.missileEntityId);

    if (!entity || (entity as MaybeActive).active === false) {
      this.emitting = false;
      this.restoreNozzleDefaults(false);
    } else if (this.emitting) {
      if (!this.resolveNozzle(entity)) {
        this.emitting = false;
      } else {
        this.flickerNozzle();
        this.emitAccumulator += EMIT_PER_SECOND * deltaTimeSeconds;
        while (this.emitAccumulator >= 1) {
          this.emitAccumulator -= 1;
          this.spawnParticle();
        }
      }
    }

    this.ageParticles(deltaTimeSeconds);

    if (!this.emitting && this.aliveCount === 0) {
      this.done = true;
    }
  }

  public override isFinished(): boolean {
    return this.done;
  }

  public override dispose(): void {
    if (this.points) this.scene.remove(this.points);
    this.geometry?.dispose();
    this.material?.dispose();
    this.points = null;
    this.geometry = null;
    this.material = null;
    this.positions = null;
    this.velocities = null;
    this.ages = null;
    this.lifetimes = null;
    this.flameCore = null;
    this.flameOuter = null;
    this.engineLight = null;
    // Do NOT dispose flame/light — owned by MeshComponent
  }

  private resolveNozzle(entity: Entity): boolean {
    const mesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
    if (mesh) {
      const core =
        (mesh.root.userData as ExhaustUserData).flameCore ?? this.flameCore;
      if (core) {
        core.getWorldPosition(this.nozzleWorld);
        return true;
      }
      this.nozzleWorld.copy(mesh.root.position);
      return true;
    }

    const transform = entity.getComponent<TransformComponent>(
      ComponentType.Transform,
    );
    if (!transform) return false;
    const p = FPVector3.ToFloat(transform.fpPosition);
    this.nozzleWorld.set(p.x, p.y, p.z);
    return true;
  }

  private spawnParticle(): void {
    if (!this.positions || !this.velocities || !this.ages || !this.lifetimes) return;
    if (this.aliveCount >= PARTICLE_CAPACITY) return;

    const i = this.aliveCount++;
    const o = i * 3;
    this.positions[o] = this.nozzleWorld.x + (Math.random() - 0.5) * 0.25;
    this.positions[o + 1] = this.nozzleWorld.y + (Math.random() - 0.5) * 0.25;
    this.positions[o + 2] = this.nozzleWorld.z + (Math.random() - 0.5) * 0.25;

    this.velocities[o] = (Math.random() - 0.5) * 0.35;
    this.velocities[o + 1] = 0.35 + Math.random() * 0.45; // slight upward drift
    this.velocities[o + 2] = (Math.random() - 0.5) * 0.35;

    this.ages[i] = 0;
    this.lifetimes[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    this.syncDrawRange();
  }

  private ageParticles(dt: number): void {
    if (!this.positions || !this.velocities || !this.ages || !this.lifetimes || !this.geometry) {
      return;
    }

    let write = 0;
    for (let read = 0; read < this.aliveCount; read++) {
      const life = this.lifetimes[read]!;
      const age = this.ages[read]! + dt;
      if (age >= life) continue;

      const ro = read * 3;
      const wo = write * 3;
      this.positions[wo] = this.positions[ro]! + this.velocities[ro]! * dt;
      this.positions[wo + 1] = this.positions[ro + 1]! + this.velocities[ro + 1]! * dt;
      this.positions[wo + 2] = this.positions[ro + 2]! + this.velocities[ro + 2]! * dt;
      this.velocities[wo] = this.velocities[ro]!;
      this.velocities[wo + 1] = this.velocities[ro + 1]!;
      this.velocities[wo + 2] = this.velocities[ro + 2]!;
      this.ages[write] = age;
      this.lifetimes[write] = life;
      write++;
    }
    this.aliveCount = write;
    this.geometry.attributes.position.needsUpdate = true;
    this.syncDrawRange();

    if (this.material) {
      this.material.opacity = this.emitting ? 0.45 : 0.35;
    }
  }

  private syncDrawRange(): void {
    this.geometry?.setDrawRange(0, this.aliveCount);
  }

  private flickerNozzle(): void {
    const pulse = 0.85 + 0.15 * Math.sin(this.elapsed * 18 + Math.random());
    const coreMat = this.flameCore?.material as THREE.MeshBasicMaterial | undefined;
    const outerMat = this.flameOuter?.material as THREE.MeshBasicMaterial | undefined;
    if (coreMat) coreMat.opacity = BASE_CORE_OPACITY * pulse;
    if (outerMat) outerMat.opacity = BASE_OUTER_OPACITY * (0.9 + 0.1 * pulse);
    if (this.engineLight) {
      this.engineLight.intensity = BASE_LIGHT_INTENSITY * pulse;
      this.engineLight.visible = true;
    }
  }

  private restoreNozzleDefaults(lightOn: boolean): void {
    const coreMat = this.flameCore?.material as THREE.MeshBasicMaterial | undefined;
    const outerMat = this.flameOuter?.material as THREE.MeshBasicMaterial | undefined;
    if (coreMat) coreMat.opacity = BASE_CORE_OPACITY;
    if (outerMat) outerMat.opacity = BASE_OUTER_OPACITY;
    if (this.engineLight) {
      this.engineLight.intensity = BASE_LIGHT_INTENSITY;
      this.engineLight.visible = lightOn;
    }
  }
}
```

**Implementation notes:**
- Per-particle opacity via a single `PointsMaterial` is approximate; acceptable for soft smoke (no custom shader).
- `ComponentType.Transform` must match the playground export used by `BeamCue.getBeamAnchor`.

Then export from `abilities-playground/src/cues/index.ts`:

```typescript
export * from './missileExhaustCue.ts';
```

Register in `SimulationContainer` cues map:

```typescript
'Cue.Missile.Exhaust': () => new MissileExhaustCue(this.scene),
```

Add `MissileExhaustCue` to the existing cues import list in that file.

- [ ] **Step 2: Typecheck**

Run from `abilities-playground`:

```bash
npx tsc --noEmit
```

Expected: no errors related to the new cue / registration.

- [ ] **Step 3: Commit**

```bash
git add abilities-playground/src/cues/missileExhaustCue.ts abilities-playground/src/cues/index.ts abilities-playground/src/core/SimulationContainer.ts
git commit -m "feat(missiles): add MissileExhaustCue for smoke trails and nozzle flicker"
```

---

### Task 3: Dispatch exhaust cue on missile spawn

**Files:**
- Create: `abilities-playground/src/hooks/dispatchMissileExhaustCue.ts`
- Modify: `abilities-playground/src/hooks/MissileVolley.ts`

**Interfaces:**
- Consumes: `MissileExhaustCue` registration from Task 2; `pools.spawn` returns `MissileEntity`
- Produces: each spawned missile immediately dispatches `{ cueId: 'Cue.Missile.Exhaust', sourceEntityId: missile.id, ... }` on the world event bus

- [ ] **Step 1: Add dispatch helper**

Create `abilities-playground/src/hooks/dispatchMissileExhaustCue.ts`:

```typescript
import {
  gameplayCueKey,
  type GameplayCueDispatchedEvent,
} from '@phalanx-engine/abilities';
import type { GameWorld } from '@phalanx-engine/ecs';

export const MISSILE_EXHAUST_CUE_ID = 'Cue.Missile.Exhaust';

export function dispatchMissileExhaustCue(
  world: GameWorld,
  missileId: number,
  tick: number,
): void {
  const event: GameplayCueDispatchedEvent = {
    tick,
    cueId: MISSILE_EXHAUST_CUE_ID,
    sourceEntityId: missileId,
    targetEntityId: missileId,
    phase: 'OnApplied',
  };
  world.eventBus.emit(gameplayCueKey(MISSILE_EXHAUST_CUE_ID), event);
}
```

- [ ] **Step 2: Wire `missileVolley`**

In `missileVolley`, change the spawn loop to:

```typescript
for (let i = 0; i < targets.length; i++) {
  const missile = world.pools.spawn<MissileEntity>('missile', {
    fpPosition: origin,
    targetEntityId: targets[i],
    teamId: team.teamId,
    volleyIndex: i,
    volleyCount: targets.length,
    launcherRotation: transform.fpRotation,
  });
  dispatchMissileExhaustCue(world, missile.id, ctx.tick);
}
```

Do **not** put `Math.random` in the hook. Do **not** change missile targeting / spawn args.

- [ ] **Step 3: Typecheck + manual visual verify**

Run from `abilities-playground`:

```bash
npx tsc --noEmit
npm run dev
```

In-game checklist:
- Soft warm nozzle glow on flying missiles
- Gray smoke trails that linger ~1.5–2.5s
- Impact cue still plays
- No leftover `THREE.Points` after missiles clear / battle reset

- [ ] **Step 4: Commit**

```bash
git add abilities-playground/src/hooks/MissileVolley.ts abilities-playground/src/hooks/dispatchMissileExhaustCue.ts
git commit -m "feat(missiles): dispatch exhaust cue when volley missiles spawn"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Soft realistic layered nozzle + PointLight | Task 1 |
| `userData` refs for cue flicker | Task 1 |
| `MissileExhaustCue` with world-space smoke, 1.5–2.5s life | Task 2 |
| Soft flicker, stop emit on inactive, fade then finish | Task 2 |
| Register cue factory + export | Task 2 |
| Dispatch on spawn | Task 3 |
| Non-deterministic smoke only in presentation | Tasks 2–3 |
| No sim/FP changes | All tasks (presentation-only) |
| Cue does not dispose mesh flame/light | Task 2 `dispose` |
| Verify visually in playground | Task 3 |

## Self-review notes

- No TDD / no new Vitest files — verification is typecheck + manual playtest.
- Dispatch uses `eventBus.emit(gameplayCueKey(...))` (PlasmaTank fire pattern) rather than `abilities.gameplayCueBuffer.push`; both reach `CuePresentationSystem`.
- Type names are consistent: `MissileExhaustCue`, `'Cue.Missile.Exhaust'`, `dispatchMissileExhaustCue`.
