# Phalanx Physics

A deterministic, fixed-point physics engine for the [Phalanx Engine](../README.md). Designed for lockstep multiplayer games where every client must produce identical simulation results.

> Sibling packages: [phalanx-ecs](../phalanx-ecs/README.md) (ECS core), [phalanx-math](../phalanx-math/README.md) (fixed-point math), [phalanx-server](../phalanx-server/README.md), [phalanx-client](../phalanx-client/README.md).

## Features

- **Deterministic by Design**: All math uses `FP.*` fixed-point operations — no floating-point non-determinism
- **SoA Storage**: Physics body data stored in contiguous typed arrays (`BigInt64Array` for fixed-point, `Uint8Array` for flags) via phalanx-ecs `SoAComponent`
- **Spatial Hash Grid**: O(n) broad-phase collision detection with configurable cell size
- **Narrow Phase**: Circle vs Circle, Circle vs AABB, and AABB vs AABB collision tests
- **Impulse Resolution**: Mass-weighted velocity impulse + positional separation for overlap correction
- **Sub-stepping**: Configurable physics sub-steps per tick for higher fidelity at the same tick rate
- **Collision Filtering**: Inject game-specific collision rules via callback — no coupling to game concepts
- **Tick Providers**: Pluggable `IPhysicsTickProvider` interface decouples tick scheduling from simulation logic — supports GameWorld-driven, autonomous (turn-based), and external (rAF) modes
- **Impulse API**: `applyImpulse()` sets body XZ velocity for flick/strike mechanics; `applyImpulse3D()` sets full 3D velocity for arcing ordnance; `isSettled()` queries whether all bodies are at rest
- **Gravity**: opt-in gravitational acceleration via `GravitySystem` + per-body `useGravity` flag; position integrated on all three axes by `PhysicsSystem` (see [Gravity](#gravity))
- **Bounds Exit Mode**: Optional `ejectOnBoundsExit` mode marks out-of-bounds bodies as ignored and emits `BOUNDS_EXIT` events instead of clamping
- **Event-Driven**: Collision, trigger enter, trigger exit, and bounds exit events emitted via phalanx-ecs `EventBus`
- **Built-in Transform & Interpolation**: `TransformComponent` (SoA fixed-point spatial state), `InterpolationComponent`, and `InterpolationSystem` for tick-to-frame render smoothing
- **PhysicsWorld Facade**: One-liner setup — wraps PhysicsSystem + InterpolationSystem, exposes event subscriptions, spatial queries, and interpolated transforms

## Core Components

### PhysicsWorld (Recommended Entry Point)
- **PhysicsWorld**: High-level facade — creates PhysicsSystem and InterpolationSystem, wires collision pipeline, exposes event subscriptions, spatial queries, and `getInterpolatedTransform()`

### Transform & Interpolation
- **TransformComponent**: SoA-backed fixed-point position and rotation (`TransformSoASchema`, `TRANSFORM_COMPONENT_TYPE`)
- **InterpolationComponent**: Tick-to-tick transform samples for render smoothing
- **InterpolationSystem**: Snapshots/captures transform state each tick and interpolates each frame (implements `IBeforeTick`, `IAfterTick`, `IBeforeFrame`)

### Physics Body
- **PhysicsBodyComponent**: SoA-backed component with velocity, radius, mass, restitution, friction, isStatic, and ignorePhysics fields
- **PhysicsSoASchema**: Schema definition for the SoA storage layout

### Collision Detection
- **SpatialHashGrid**: Broad-phase spatial partitioning with `queryPairs()` and `queryRadius()`
- **NarrowPhase**: Static methods for precise collision geometry tests

### Systems
- **PhysicsSystem**: Velocity integration with sub-stepping, world bounds handling, broad/narrow/resolve collision pipeline, `step()` / `applyImpulse()` / `isSettled()` / `setCollisionFilter()` API. Created and owned by `PhysicsWorld`; retrieve it via `physicsWorld.getSystems().physicsSystem` to register with `GameWorld`.
- **InterpolationSystem**: Tick/frame lifecycle hooks for transform interpolation. Register as a **frame system** via `physicsWorld.getSystems().interpolationSystem`.

### Tick Providers
- **IPhysicsTickProvider**: Interface for custom tick scheduling strategies
- **AutonomousPhysicsTickProvider**: Runs physics loop via `setImmediate` (Node.js) or `setTimeout(0)` (browser) until settled or `maxSteps` reached — ideal for turn-based games
- **ExternalPhysicsTickProvider**: Delegates tick control to the caller (e.g. BabylonJS `onBeforeRenderObservable` or unit tests)

### Events
- **PhysicsEvents.COLLISION**: Emitted when two bodies collide
- **PhysicsEvents.TRIGGER_ENTER**: Emitted when a trigger overlap starts
- **PhysicsEvents.TRIGGER_EXIT**: Emitted when a trigger overlap ends
- **PhysicsEvents.BOUNDS_EXIT**: Emitted when a body exits `worldBounds` and `ejectOnBoundsExit` is `true`

## Installation

> ⚠️ **Not on npm yet** — clone the monorepo and install via pnpm.

```bash
git clone https://github.com/phaeton-forge/phalanx-engine.git
cd phalanx-engine
pnpm install
pnpm --filter @phalanx-engine/physics build
```

Peer dependencies: `@phalanx-engine/ecs` ^0.1.0, `@phalanx-engine/math` ^0.1.0

## Imports

```typescript
import {
  // Facade & config
  PhysicsWorld,
  type PhysicsWorldConfig,

  // Components
  PhysicsBodyComponent,
  PhysicsSoASchema,
  PHYSICS_BODY_COMPONENT_TYPE,
  TransformComponent,
  TransformSoASchema,
  TRANSFORM_COMPONENT_TYPE,
  InterpolationComponent,
  INTERPOLATION_COMPONENT_TYPE,
  type PhysicsBodyConfig,

  // Collision primitives
  SpatialHashGrid,
  NarrowPhase,
  type CollisionManifold,

  // Systems
  PhysicsSystem,
  InterpolationSystem,
  type InterpolatedTransformSample,

  // Events & event types
  PhysicsEvents,
  type CollisionEvent,
  type BoundsExitEvent,

  // Tick providers
  type IPhysicsTickProvider,
  AutonomousPhysicsTickProvider,
  type AutonomousProviderOptions,
  ExternalPhysicsTickProvider,

  // Misc types
  type CollisionFilter,
  type PhysicsConfig,
} from '@phalanx-engine/physics';
```

## Quick Start

```typescript
import { GameWorld, GameSystem, createComponentTypeRegistry } from '@phalanx-engine/ecs';
import {
  PhysicsWorld,
  PhysicsBodyComponent,
  TransformComponent,
  InterpolationComponent,
  PHYSICS_BODY_COMPONENT_TYPE,
  TRANSFORM_COMPONENT_TYPE,
  INTERPOLATION_COMPONENT_TYPE,
} from '@phalanx-engine/physics';
import { FP, FPVector3, FPQuaternion } from '@phalanx-engine/math';

// Register canonical component type symbols from phalanx-physics
export const ComponentType = createComponentTypeRegistry({
  Transform: 'Transform',
  Interpolation: 'Interpolation',
  PhysicsBody: 'PhysicsBody',
});
(ComponentType as Record<string, symbol>).Transform = TRANSFORM_COMPONENT_TYPE;
(ComponentType as Record<string, symbol>).Interpolation = INTERPOLATION_COMPONENT_TYPE;
(ComponentType as Record<string, symbol>).PhysicsBody = PHYSICS_BODY_COMPONENT_TYPE;

// Minimal placeholder systems — replace with your real ones.
class MovementSystem extends GameSystem {
  public override processTick(_tick: number): void { /* set velocities here */ }
}
class RenderSystem extends GameSystem {
  public override update(_dt: number): void {
    const sample = this.physics?.getInterpolatedTransform(entityId);
    if (sample) {
      mesh.position.set(sample.position.x, sample.position.y, sample.position.z);
      // sample.rotation is a float quaternion { x, y, z, w } — apply it as-is.
      mesh.quaternion.set(sample.rotation.x, sample.rotation.y, sample.rotation.z, sample.rotation.w);
    }
  }
}
const movementSystem = new MovementSystem();
const renderSystem = new RenderSystem();

// 1. Create GameWorld and the physics facade
const world = new GameWorld({ componentTypes: Object.values(ComponentType) });

const physicsWorld = new PhysicsWorld({
  gridCellSize: FP.FromFloat(8),
  subSteps: 3,
  tickRate: 20,
  maxVelocity: FP.FromFloat(15),
  pushStrength: FP.FromFloat(15),
});

// 2. Wire physics into SystemContext so systems can access it
world.context.physics = physicsWorld;

// 3. Register systems with GameWorld (order matters)
const { physicsSystem, interpolationSystem } = physicsWorld.getSystems();
world.registerSystems(
  [movementSystem, physicsSystem],   // tick systems
  [interpolationSystem, renderSystem], // frame systems — InterpolationSystem runs before render
);

world.start();

// 4. Add transform, interpolation, and physics body to entities
declare const entity: { id: number; addComponent(c: unknown): void };
const fpPosition = FPVector3.FromFloat(0, 0, 0);
const fpRotation = FPQuaternion.Identity();
entity.addComponent(new TransformComponent(entity.id, fpPosition, fpRotation));
entity.addComponent(new InterpolationComponent(fpPosition, fpRotation));
entity.addComponent(new PhysicsBodyComponent(entity.id, { radius: FP.FromFloat(1.0) }));
world.entityManager.addEntity(entity as any);

// 5. Subscribe to collision events (must be called after world.start())
physicsWorld.onCollision((event) => {
  console.log(`Collision: ${event.entityA} ↔ ${event.entityB}`);
});
```

> **Note:** `PhysicsSystem` reads and writes the built-in `TransformSoASchema` store directly — no `setTransformStore()` or consumer-defined transform schema is required. Register `Transform`, `Interpolation`, and `PhysicsBody` component types using the canonical symbols exported from phalanx-physics.

## Turn-Based Physics (Tick Providers)

For turn-based games like Chapayev checkers, use a tick provider to decouple simulation from the server tick loop:

```typescript
import {
  PhysicsWorld,
  AutonomousPhysicsTickProvider,
} from '@phalanx-engine/physics';
import { FP } from '@phalanx-engine/math';

// Game defines what "settled" means and what happens when it occurs
let physicsWorld: PhysicsWorld;

const provider = new AutonomousPhysicsTickProvider({
  isSettled: () => physicsWorld.isSettled(),
  onSettled: () => {
    // Game-level logic: turn is over
    sendTurnEnd(getCheckerPositions());
  },
});

physicsWorld = new PhysicsWorld({
  tickRate: 60,
  subSteps: 3,
  ejectOnBoundsExit: true,
  worldBounds: {
    minX: FP.FromFloat(-8), maxX: FP.FromFloat(8),
    minZ: FP.FromFloat(-8), maxZ: FP.FromFloat(8),
  },
  tickProvider: provider,
});

// Player flicks a checker
function onFlick(entityId: number, dirX: number, dirZ: number, power: number) {
  const speed = power * 12;
  physicsWorld.applyImpulse(
    entityId,
    FP.FromFloat(dirX * speed),
    FP.FromFloat(dirZ * speed),
  );
}

// Checker exits the board
physicsWorld.onBoundsExit(({ entityId }) => {
  removeChecker(entityId);
});
```

### Tick Provider Options

| Provider | Use Case |
|---|---|
| *(none / default)* | GameWorld `processTick()` drives simulation — real-time games |
| `AutonomousPhysicsTickProvider` | Runs until settled or `maxSteps` — turn-based physics |
| `ExternalPhysicsTickProvider` | Caller invokes `tick()` manually — BabylonJS rAF, unit tests |

## API Reference

### `PhysicsWorld`

```typescript
class PhysicsWorld {
  constructor(config?: PhysicsWorldConfig);

  // System wiring
  getSystems(): { physicsSystem: PhysicsSystem; gravitySystem: GravitySystem; interpolationSystem: InterpolationSystem };
  setCollisionFilter(filter: (entityA: number, entityB: number) => boolean): void;

  // Event subscriptions (must be called after GameWorld.start())
  onCollision(callback: (event: CollisionEvent) => void): () => void;
  onBoundsExit(callback: (event: BoundsExitEvent) => void): () => void;

  // Planned — not yet emitted by PhysicsSystem.
  onTriggerEnter(callback: (event: CollisionEvent) => void): () => void;
  onTriggerExit(callback: (event: CollisionEvent) => void): () => void;

  // Impulse / settle queries
  applyImpulse(entityId: number, vx: FixedPoint, vz: FixedPoint): void;
  applyImpulse3D(entityId: number, vx: FixedPoint, vy: FixedPoint, vz: FixedPoint): void;
  isSettled(threshold?: FixedPoint): boolean;

  // 3D collision workaround — see "Raycast / swept-segment queries"
  raycastSegment(prev: { x: FixedPoint; y: FixedPoint; z: FixedPoint }, cur: { x: FixedPoint; y: FixedPoint; z: FixedPoint }, boxes: ReadonlyArray<AABB3>): RayHit | null;

  // Spatial / transform queries
  readonly spatialGrid: SpatialHashGrid;
  getEntityPosition(entityId: number): { x: FixedPoint; z: FixedPoint } | undefined;
  getInterpolatedTransform(entityId: number): InterpolatedTransformSample | undefined;

  // Cleanup
  dispose(): void;
}
```

- **`getSystems()`** — Returns `physicsSystem` and `gravitySystem` (register as tick systems, gravity before physics) and `interpolationSystem` (register as frame system). Backward-compatible: destructuring only `{ physicsSystem, interpolationSystem }` still works.
- **`getEntityPosition(entityId)`** — Fixed-point position for gameplay queries (e.g. ability targeting).
- **`getInterpolatedTransform(entityId)`** — Interpolated float transform for rendering, populated after `InterpolationSystem` runs. Returns an `InterpolatedTransformSample` with `position: { x, y, z }` and `rotation: { x, y, z, w }` — rotation is a float quaternion (slerped between tick samples), apply it directly to a mesh quaternion.

- **`applyImpulse(entityId, vx, vz)`** — Set body XZ velocity (replaces, does not accumulate). Re-enables previously ejected bodies.
- **`applyImpulse3D(entityId, vx, vy, vz)`** — Set full 3D body velocity (replaces all three axes). Re-enables previously ejected bodies. Use for arcing ordnance; see [Gravity](#gravity).
- **`isSettled(threshold?)`** — Pure query: `true` when all non-static, non-ignored bodies are below velocity threshold (default from config, falling back to `FP.FromFloat(0.01)`). Considers the full 3D velocity (X, Y, Z), so a body falling on Y alone is correctly reported as not settled.
- **`onBoundsExit(callback)`** — Subscribe to `BOUNDS_EXIT` events (requires `ejectOnBoundsExit: true`).
- **`setCollisionFilter(filter)`** — Inject a per-pair predicate. Return `false` to skip collision resolution for that pair.

### `PhysicsWorldConfig`

```typescript
interface PhysicsWorldConfig {
  gridCellSize?: FixedPoint;     // default FP.FromFloat(4)
  subSteps?: number;             // default 3
  tickRate?: number;             // default 20 — used to compute tickDt
  worldBounds?: { minX: FixedPoint; minZ: FixedPoint; maxX: FixedPoint; maxZ: FixedPoint };
  defaultRestitution?: FixedPoint;
  defaultFriction?: FixedPoint;  // default FP.FromFloat(0.92)
  maxVelocity?: FixedPoint;      // default FP.FromFloat(15)
  pushStrength?: FixedPoint;     // default FP.FromFloat(15)
  collisionResponse?: 'push' | 'impulse'; // default 'push'
  restitution?: FixedPoint;      // impulse mode only; falls back to per-body restitution
  tickProvider?: IPhysicsTickProvider;
  ejectOnBoundsExit?: boolean;   // default false
  settleThreshold?: FixedPoint;  // default FP.FromFloat(0.01)
  gravity?: FixedPoint;          // acceleration magnitude, default 0 (disabled)
  gravityAxis?: 'x' | 'y' | 'z'; // default 'y'; only 'y' supported in v1
}
```

### Collision Response (`'push'` vs `'impulse'`)

`collisionResponse` selects how overlapping bodies are resolved. It defaults to
`'push'`, so existing consumers are unchanged.

| Mode | Behavior | Use when |
|---|---|---|
| `'push'` *(default)* | Positional separation plus a mass-weighted push velocity scaled by `pushStrength`. Does **not** conserve momentum — a fast body slides past a slower one. Cheap and very stable. | Crowd/soft separation, characters, projectiles that shouldn't ricochet — most real-time games. |
| `'impulse'` | Momentum-conserving elastic collision along the contact normal. Applies the impulse scalar `j = (1 + e) · vₙ / (1/mₐ + 1/m_b)` (`vₙ` = relative velocity along the normal), with a "skip if separating" guard. Restores the "click / knock-away" feel. | Billiards / Chapayev checkers / air-hockey — anything where a strike must transfer momentum. |

In `'impulse'` mode the restitution coefficient `e` comes from
`config.restitution` when set, otherwise from the average of the two bodies'
per-body `restitution`. `e = 0` is perfectly inelastic; `e = 1` is perfectly
elastic (equal-mass head-on bodies swap velocities). Only the XZ velocity
components are affected — `velocityY` is left untouched. Static bodies are
treated as infinite mass (they don't move and reflect the dynamic body).

```typescript
// Chapayev-style knock-away collisions
const physicsWorld = new PhysicsWorld({
  collisionResponse: 'impulse',
  restitution: FP.FromFloat(0.85),
});
```

## Gravity

Gravity is **opt-in** and off by default (`gravity` defaults to `0`, so
`GravitySystem` is a no-op and existing bodies are unaffected). It is designed
for arcing ordnance — artillery shrapnel, thrown grenades, anything that leaves
the ground plane.

### Model: acceleration vs. integration

The engine follows the "one owner per axis" rule to avoid double-integration:

| Concern | Owner | What it does |
|---|---|---|
| **Acceleration** | `GravitySystem` | For bodies with `useGravity=true`, decays velocity along the gravity axis each tick: `velocityY -= gravity * tickDt`. **Never writes position.** |
| **Integration** | `PhysicsSystem.applyVelocities` | Integrates position from velocity on **all three axes**: `posX/Y/Z += velX/Y/Z * dt`. This is the *only* position integrator. |

Because `PhysicsSystem` already integrates X/Z, gravity is restricted to the Y
axis — applying it to X/Z would double-integrate those axes (the body would move
twice and desync friction/clamp). See `gravityAxis` below.

Y integration is **additive and safe**: `maxVelocity` and `worldBounds` clamps
remain XZ-only, and collision detection stays 2D/XZ (a shrapnel body at altitude
flies over ground units). Bodies with `velocityY = 0` — i.e. every pre-existing
body — do not move on Y, so behavior is unchanged.

### `useGravity` flag

Per-body opt-in, set via `PhysicsBodyConfig.useGravity` (default `false`):

```typescript
new PhysicsBodyComponent(entity.id, {
  radius: FP.FromFloat(0.2),
  friction: FP._1,     // no XZ damping for a projectile
  useGravity: true,    // GravitySystem will pull it down
});
```

### `gravityAxis` — why only `'y'`

`gravityAxis` defaults to `'y'` and **only `'y'` is supported in v1**.
Constructing `GravitySystem` with `'x'` or `'z'` throws. Those axes are owned by
`PhysicsSystem`'s position integrator; letting `GravitySystem` also drive them
would double-integrate. `'x'`/`'z'` are reserved for a future version that would
cede an axis from `PhysicsSystem`.

### `applyImpulse3D`

`applyImpulse()` sets only XZ velocity (backward-compatible). To launch a body
with vertical velocity, use `applyImpulse3D(entityId, vx, vy, vz)` — it replaces
all three velocity components and clears `ignorePhysics`.

```typescript
// Launch shrapnel up and out; GravitySystem arcs it back down.
physicsWorld.applyImpulse3D(shrapnelId, FP.FromFloat(6), FP.FromFloat(8), FP.FromFloat(-3));
```

### System ordering

Register **`GravitySystem` before `PhysicsSystem`** so the tick's acceleration is
applied before that tick's integration (semi-implicit Euler):

```typescript
const { gravitySystem, physicsSystem, interpolationSystem } = physicsWorld.getSystems();
world.registerSystems(
  [movementSystem, gravitySystem, physicsSystem, /* landing systems… */],
  [interpolationSystem, renderSystem],
);
```

`getSystems()` remains backward-compatible: callers that destructure only
`{ physicsSystem, interpolationSystem }` simply ignore `gravitySystem`.

### Tick-resolution gravity vs. sub-stepped integration

`GravitySystem` runs once per `GameWorld` tick, while `PhysicsSystem` sub-steps
(e.g. 3×). Gravity is applied once per tick, then that same `velocityY` is
integrated across every sub-step. The net ΔY per tick is `velocityY * tickDt`
(semi-implicit Euler) — correct for gameplay. Sub-step-accurate gravity would
require folding the acceleration into `PhysicsSystem.step()`'s loop (at which
point it would no longer be a separate system); this is intentionally not done.

## Raycast / swept-segment queries (3D collision workaround)

The body-vs-body narrow phase is **2D/XZ only** (circles on the ground plane) and
has no notion of height. For **3D collision** — e.g. a fast-moving ordnance
(artillery shrapnel, shell, projectile) hitting a static obstacle such as a
building, where you need the impact point and surface normal — use the swept-
segment raycast query as a **workaround** until a full 3D body-body collision
system is implemented (planned v2: `BoxColliderComponent` as ECS entities +
grid-accelerated raycast + 3D sphere/box vs sphere/box resolution).

```typescript
import { FP } from '@phalanx-engine/math';
import { PhysicsWorld, type AABB3, type RayHit } from '@phalanx-engine/physics';

// prev = previous tick position of the shard, cur = current position (after
// gravity + integration ran). buildings = static 3D AABBs.
const hit: RayHit | null = physicsWorld.raycastSegment(prev, cur, buildings);
if (hit) {
  spawnSecondaryAoE(hit.point, radii);   // explosion on the wall
  cue(Impact, hit.point);                // VFX/SFX at the impact
  // hit.normal is the outward face normal — use for ricochet / impulse direction.
  despawn(shrapnel);
  return;
}
// No building hit -> check ground plane, else carry prevPos forward next tick.
```

- `segmentVsAABB(prev, cur, box)` — pure slab-method query returning
  `{ t, point, normal }` (t in `[0,1]` along the segment, `point = lerp(prev, cur, t)`,
  `normal` = outward face normal of the entry plane) or `null`.
- `PhysicsWorld.raycastSegment(prev, cur, boxes)` — scans a caller-supplied list of
  static `AABB3` boxes and returns the **nearest** hit, or `null`.

Using the swept segment (not point-in-box per tick) prevents **tunneling**: a
fast shard cannot skip through a thin wall between ticks.

**v1 limitations:** linear scan over caller-supplied boxes (no broad-phase
acceleration) — fine for tens of obstacles; the unit-vs-unit 2D circle pipeline
is untouched. **v2 path:** `BoxColliderComponent` as ECS entities + spatial-grid
raycast + full 3D body-body collision.

### `TransformComponent`

```typescript
class TransformComponent extends SoAComponent<typeof TransformSoASchema.definition> {
  static readonly soaSchema: typeof TransformSoASchema;
  readonly type: symbol; // TRANSFORM_COMPONENT_TYPE

  constructor(entityId: number, initialPosition?: FPVector3, initialRotation?: FPQuaternion);

  fpPosition: FPVector3;        // get/set — authoritative fixed-point position
  fpRotation: FPQuaternion;     // get/set — authoritative rotation quaternion
  fpRotationEuler: FPVector3;   // get/set — computed Euler view (radians, XYZ order)
  fpRotationY: FixedPoint;      // get/set — convenience Y-yaw (radians)
}
```

Rotation is authoritatively a quaternion (`fpRotation`). `fpRotationEuler` (XYZ Euler radians) and `fpRotationY` (yaw) are computed views over it — recomputed on each access, mirroring Unity's `Transform.rotation` / `Transform.eulerAngles`. Setting `fpRotationEuler` calls `FPQuaternion.FromEulerXYZ`; setting `fpRotationY` builds a yaw rotation around `FPVector3.Up`.

`TransformSoASchema` fields: `fpPositionX/Y/Z`, `fpRotationX/Y/Z/W` (all `i64`). Rotation defaults to the identity quaternion (`w = 1`).

### `InterpolationComponent`

```typescript
class InterpolationComponent implements IComponent {
  readonly type: symbol; // INTERPOLATION_COMPONENT_TYPE

  constructor(initialPosition?: FPVector3, initialRotation?: FPQuaternion);

  snapshot(): void;  // copy current → previous (called by InterpolationSystem before tick)
  capture(fpPosition: FPVector3, fpRotation: FPQuaternion): void; // capture authoritative state after tick
}
```

Attach alongside `TransformComponent` on any entity that needs render interpolation.

### `PhysicsBodyComponent`

```typescript
class PhysicsBodyComponent extends SoAComponent<typeof PhysicsSoASchema.definition> {
  static readonly soaSchema: typeof PhysicsSoASchema;
  readonly type: symbol; // PHYSICS_BODY_COMPONENT_TYPE

  constructor(entityId: number, config: PhysicsBodyConfig);

  // Velocity
  velocity: FPVector3;                                       // get/set (returns cached object)
  setVelocity(x: FixedPoint, y: FixedPoint, z: FixedPoint): void;
  addVelocity(velocity: FPVector3): void;
  stopVelocity(): void;

  // Read-only attributes
  readonly radius: FixedPoint;
  readonly radiusFloat: number;
  readonly mass: FixedPoint;
  readonly restitution: FixedPoint;
  readonly friction: FixedPoint;
  readonly isStatic: boolean;
  ignorePhysics: boolean;        // get/set
  useGravity: boolean;           // get/set — opt in to GravitySystem acceleration

  // Spatial-grid bookkeeping
  lastX: number;
  lastZ: number;
}

interface PhysicsBodyConfig {
  radius: FixedPoint;
  mass?: FixedPoint;             // default FP._1
  isStatic?: boolean;            // default false
  restitution?: FixedPoint;      // default FP.FromFloat(0.5)
  friction?: FixedPoint;         // default FP._0
  useGravity?: boolean;          // default false — opt in to GravitySystem acceleration
}
```

For hot-path access, prefer the SoA store directly:

```typescript
const store = entityManager.getOrCreateSoAStore(PhysicsSoASchema);
const idx = store.indexOf(entityId);
store.arrays.velocityX[idx] = FP.ToRaw(newVx);
```

### Collision primitives

- **`SpatialHashGrid`** — broad-phase O(n) neighbor pairing. Methods: `clear()`, `insert(...)`, `queryPairs()`, `queryRadius(...)`. Access via `physicsWorld.spatialGrid` for ad-hoc range queries.
- **`NarrowPhase`** — static methods for circle/AABB intersection tests. Returns `CollisionManifold | null`.
- **`CollisionManifold`** — `{ entityA, entityB, normalX, normalZ, penetration }`.

### Tick providers

```typescript
interface IPhysicsTickProvider {
  /** Start the provider; it calls `onStep` whenever physics should advance one step. */
  start(onStep: () => void): void;
  /** Stop the provider and release any timers/handles. */
  stop(): void;
}

interface AutonomousProviderOptions {
  /** Called every step to decide whether to stop (defined by the game). */
  isSettled: () => boolean;
  /** Called once when simulation settles or `maxSteps` is reached. */
  onSettled: () => void;
  /** Max simulation steps before forcing a stop. Default: 10000. */
  maxSteps?: number;
}

class AutonomousPhysicsTickProvider implements IPhysicsTickProvider {
  constructor(options: AutonomousProviderOptions);
  // Schedules `onStep` via setImmediate (Node) or setTimeout(0) (browser)
  // until isSettled() returns true or maxSteps is reached.
}

class ExternalPhysicsTickProvider implements IPhysicsTickProvider {
  /** Manually advance one physics step from your render loop / test harness. */
  tick(): void;
}
```

### Events

```typescript
const PhysicsEvents = {
  COLLISION:     'physics:collision',
  TRIGGER_ENTER: 'physics:trigger:enter',
  TRIGGER_EXIT:  'physics:trigger:exit',
  BOUNDS_EXIT:   'physics:bounds:exit',
} as const;

interface CollisionEvent { entityA: number; entityB: number; manifold: CollisionManifold; }
interface BoundsExitEvent { entityId: number; }
```
