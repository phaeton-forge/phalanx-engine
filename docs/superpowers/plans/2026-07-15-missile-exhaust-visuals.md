# Missile Exhaust Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give abilities-playground missiles a soft realistic engine glow and non-deterministic smoke trails via mesh upgrades plus a long-lived `MissileExhaustCue`.

**Architecture:** Upgrade `MeshComponent.createMissile()` with a layered nozzle + `PointLight` (refs on `group.userData`). Add `MissileExhaustCue` that follows the missile, emits/ages gray smoke particles, and soft-flickers the nozzle. Dispatch the cue from `missileVolley` on each spawn via `eventBus.emit(gameplayCueKey(...))` (same presentation path as `plasmaTankMachineGun` fire cue). Simulation / FP paths stay untouched.

**Tech Stack:** TypeScript, Three.js, Vitest, `@phalanx-engine/abilities` Cue API, abilities-playground ECS

## Global Constraints

- Presentation only — no FP/sim/replay changes; smoke uses `Math.random` freely in cue code
- Soft realistic look; smoke particle lifetime ~1.5–2.5s
- Cue must not dispose mesh-owned flame/light objects
- Follow existing cue patterns (`BeamCue` lifecycle, `MissileImpactCue` Points style, `PlasmaTankMachineGun` hook dispatch)
- Work in `phalanx-engine` git root under `abilities-playground/`

---

## File map

| File | Responsibility |
| --- | --- |
| `abilities-playground/src/components/UnitComponents.ts` | Soft nozzle glow + `userData` refs in `createMissile` |
| `abilities-playground/src/cues/missileExhaustCue.ts` | Long-lived exhaust cue (smoke + flicker) |
| `abilities-playground/src/cues/index.ts` | Export cue |
| `abilities-playground/src/core/SimulationContainer.ts` | Register `'Cue.Missile.Exhaust'` factory |
| `abilities-playground/src/hooks/MissileVolley.ts` | Dispatch exhaust cue per spawned missile |
| `abilities-playground/tests/createMissileVisual.test.ts` | Mesh/userData structure tests |
| `abilities-playground/tests/MissileExhaustCue.test.ts` | Cue lifecycle tests (no particle-position asserts) |

---

### Task 1: Soft nozzle glow on missile mesh

**Files:**
- Modify: `abilities-playground/src/components/UnitComponents.ts` (`createMissile`, ~lines 212–243)
- Create: `abilities-playground/tests/createMissileVisual.test.ts`

**Interfaces:**
- Consumes: existing `MeshComponent.createMissile(): MeshComponent`, `MeshComponent.initScene(scene)`
- Produces: `group.userData` shape used by Task 2:
  - `flameCore: THREE.Mesh`
  - `flameOuter: THREE.Mesh`
  - `engineLight: THREE.PointLight`
  - (optional helper) nozzle is `flameCore` world position

- [ ] **Step 1: Write the failing test**

Create `abilities-playground/tests/createMissileVisual.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MeshComponent } from '../src/components';

describe('MeshComponent.createMissile exhaust visuals', () => {
  beforeEach(() => {
    MeshComponent.initScene(new THREE.Scene());
  });

  it('exposes soft nozzle meshes and a short-range engine light on userData', () => {
    const mesh = MeshComponent.createMissile();
    const data = mesh.root.userData;

    expect(data.flameCore).toBeInstanceOf(THREE.Mesh);
    expect(data.flameOuter).toBeInstanceOf(THREE.Mesh);
    expect(data.engineLight).toBeInstanceOf(THREE.PointLight);

    const light = data.engineLight as THREE.PointLight;
    expect(light.intensity).toBeGreaterThan(0);
    expect(light.distance).toBeGreaterThan(0);
    expect(light.distance).toBeLessThanOrEqual(8);

    const coreMat = (data.flameCore as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const outerMat = (data.flameOuter as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(coreMat.transparent).toBe(true);
    expect(outerMat.transparent).toBe(true);
    expect(coreMat.blending).toBe(THREE.AdditiveBlending);
    expect(outerMat.blending).toBe(THREE.AdditiveBlending);
    expect(coreMat.depthWrite).toBe(false);
    expect(outerMat.depthWrite).toBe(false);

    expect(mesh.root.children).toContain(data.flameCore);
    expect(mesh.root.children).toContain(data.flameOuter);
    expect(mesh.root.children).toContain(data.engineLight);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- createMissileVisual.test.ts`  
Working directory: `abilities-playground`  
Expected: FAIL (missing `userData.flameCore` / `engineLight`, or only one flame child)

- [ ] **Step 3: Implement soft nozzle in `createMissile`**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- createMissileVisual.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add abilities-playground/src/components/UnitComponents.ts abilities-playground/tests/createMissileVisual.test.ts
git commit -m "feat(missiles): add soft nozzle glow meshes and engine light"
```

---

### Task 2: `MissileExhaustCue` (smoke + flicker)

**Files:**
- Create: `abilities-playground/src/cues/missileExhaustCue.ts`
- Modify: `abilities-playground/src/cues/index.ts`
- Modify: `abilities-playground/src/core/SimulationContainer.ts` (cues map + import)
- Create: `abilities-playground/tests/MissileExhaustCue.test.ts`

**Interfaces:**
- Consumes: `group.userData.flameCore|flameOuter|engineLight` from Task 1; `Cue` / `CueContext` / `GameplayCueDispatchedEvent` from `@phalanx-engine/abilities`; `ComponentType.Mesh`, `MeshComponent`, `TransformComponent`
- Produces: `export class MissileExhaustCue extends Cue` with constructor `(scene: THREE.Scene)`; cue id string `'Cue.Missile.Exhaust'` for Task 3

- [ ] **Step 1: Write the failing lifecycle tests**

Create `abilities-playground/tests/MissileExhaustCue.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Entity, EntityManager } from '@phalanx-engine/ecs';
import type { CueContext, GameplayCueDispatchedEvent } from '@phalanx-engine/abilities';
import { ComponentType, MeshComponent } from '../src/components';
import { MissileExhaustCue } from '../src/cues/missileExhaustCue';

function cueEvent(missileId: number): GameplayCueDispatchedEvent {
  return {
    tick: 1,
    cueId: 'Cue.Missile.Exhaust',
    sourceEntityId: missileId,
    targetEntityId: missileId,
    phase: 'OnApplied',
  };
}

describe('MissileExhaustCue', () => {
  let scene: THREE.Scene;
  let entityManager: EntityManager;
  let context: CueContext;

  beforeEach(() => {
    scene = new THREE.Scene();
    MeshComponent.initScene(scene);
    entityManager = new EntityManager();
    entityManager.registerComponentTypes([ComponentType.Mesh]);
    context = { entityManager, eventBus: { emit() {}, on() {}, off() {} } as never };
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finishes immediately when the missile entity is missing', () => {
    const cue = new MissileExhaustCue(scene);
    cue.onSpawn(cueEvent(999), context);
    expect(cue.isFinished()).toBe(true);
    cue.dispose();
  });

  it('keeps fading smoke after the missile goes inactive, then finishes', () => {
    const entity = new Entity();
    const mesh = MeshComponent.createMissile();
    entity.addComponent(mesh);
    // Mimic MissileEntity.active without importing the full entity graph
    (entity as { active?: boolean }).active = true;
    entityManager.addEntity(entity);

    const cue = new MissileExhaustCue(scene);
    cue.onSpawn(cueEvent(entity.id), context);
    expect(cue.isFinished()).toBe(false);

    // Emit for a couple frames
    cue.update(0.05);
    cue.update(0.05);
    expect(scene.children.some((c) => c instanceof THREE.Points)).toBe(true);

    (entity as { active?: boolean }).active = false;
    mesh.root.visible = false;

    // Advance past max particle lifetime (~2.5s) without asserting positions
    for (let i = 0; i < 60; i++) cue.update(0.05);
    expect(cue.isFinished()).toBe(true);

    cue.dispose();
    expect(scene.children.some((c) => c instanceof THREE.Points)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- MissileExhaustCue.test.ts`  
Working directory: `abilities-playground`  
Expected: FAIL (module not found / class missing)

- [ ] **Step 3: Implement `MissileExhaustCue`**

Create `abilities-playground/src/cues/missileExhaustCue.ts` with this behavior (complete implementation; tune constants within soft-realistic bounds):

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
      // Soft overall fade while any smoke remains
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

**Implementation notes for the agent:**
- Per-particle opacity via a single `PointsMaterial` is approximate; that is acceptable for soft smoke (do not add a custom shader unless needed).
- `ComponentType.Transform` must match the playground export used elsewhere (same as `BeamCue.getBeamAnchor`).

Then export from `abilities-playground/src/cues/index.ts`:

```typescript
export * from './missileExhaustCue.ts';
```

Register in `SimulationContainer` cues map:

```typescript
'Cue.Missile.Exhaust': () => new MissileExhaustCue(this.scene),
```

Add `MissileExhaustCue` to the existing cues import list in that file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- MissileExhaustCue.test.ts`  
Expected: PASS

Also run: `npm test -- createMissileVisual.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add abilities-playground/src/cues/missileExhaustCue.ts abilities-playground/src/cues/index.ts abilities-playground/src/core/SimulationContainer.ts abilities-playground/tests/MissileExhaustCue.test.ts
git commit -m "feat(missiles): add MissileExhaustCue for smoke trails and nozzle flicker"
```

---

### Task 3: Dispatch exhaust cue on missile spawn

**Files:**
- Modify: `abilities-playground/src/hooks/MissileVolley.ts`
- Test: extend or add a focused assertion via existing tests if present; otherwise manual + keep Task 2 coverage. Prefer a small unit test of a helper if extracting one.

**Interfaces:**
- Consumes: `MissileExhaustCue` registration from Task 2; `pools.spawn` returns `MissileEntity`
- Produces: each spawned missile immediately dispatches `{ cueId: 'Cue.Missile.Exhaust', sourceEntityId: missile.id, ... }` on the world event bus

- [ ] **Step 1: Write a failing dispatch helper test (optional but preferred)**

If extracting a tiny helper keeps the hook clean, add `abilities-playground/src/hooks/bufferMissileExhaustCue.ts` (name can be `dispatchMissileExhaustCue` since this uses eventBus emit, not the abilities buffer):

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

Test `abilities-playground/tests/dispatchMissileExhaustCue.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '@phalanx-engine/ecs';
import { gameplayCueKey } from '@phalanx-engine/abilities';
import {
  MISSILE_EXHAUST_CUE_ID,
  dispatchMissileExhaustCue,
} from '../src/hooks/bufferMissileExhaustCue';

describe('dispatchMissileExhaustCue', () => {
  it('emits the exhaust cue event for the missile id', () => {
    const eventBus = new EventBus();
    const world = { eventBus } as never;
    const spy = vi.fn();
    eventBus.on(gameplayCueKey(MISSILE_EXHAUST_CUE_ID), spy);

    dispatchMissileExhaustCue(world, 42, 7);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      cueId: MISSILE_EXHAUST_CUE_ID,
      sourceEntityId: 42,
      targetEntityId: 42,
      tick: 7,
      phase: 'OnApplied',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dispatchMissileExhaustCue.test.ts`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement helper + wire `missileVolley`**

1. Add the helper file from Step 1.
2. In `missileVolley`, change the spawn loop to:

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

- [ ] **Step 4: Run tests**

Run from `abilities-playground`:

```bash
npm test -- createMissileVisual.test.ts MissileExhaustCue.test.ts dispatchMissileExhaustCue.test.ts MissileQuaternion.test.ts
```

Expected: all PASS

Manual check (when convenient): `npm run dev` in abilities-playground, fire missile volley — soft glow + gray smoke lingering ~1.5–2.5s; impact cue still plays; no leftover Points after missiles clear.

- [ ] **Step 5: Commit**

```bash
git add abilities-playground/src/hooks/MissileVolley.ts abilities-playground/src/hooks/bufferMissileExhaustCue.ts abilities-playground/tests/dispatchMissileExhaustCue.test.ts
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
| No sim/FP changes; existing missile tests stay green | Task 3 verification |
| Cue does not dispose mesh flame/light | Task 2 `dispose` |

## Self-review notes

- No TBD placeholders.
- Dispatch uses `eventBus.emit(gameplayCueKey(...))` (PlasmaTank fire pattern) rather than `abilities.gameplayCueBuffer.push`; both reach `CuePresentationSystem`. Chosen so the hook does not need an `AbilitySystem` parameter.
- Type names are consistent: `MissileExhaustCue`, `'Cue.Missile.Exhaust'`, `dispatchMissileExhaustCue`.
