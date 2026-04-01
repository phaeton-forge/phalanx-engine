# Task: Create `phalanx-physics` Package & Refactor `direct-strike-babylon-example`

## Context

Phalanx Engine is a TypeScript game engine with a monorepo structure. The existing packages are:

| Package | Purpose |
|---------|---------|
| `phalanx-ecs` | Lightweight ECS library: `GameWorld`, `EntityManager`, `GameSystem`, `EventBus`, `SoAComponent`, `ObjectPool` |
| `phalanx-math` | Deterministic fixed-point math: `FP`, `FPVector2`, `FPVector3` (integer arithmetic, no floating-point desync) |
| `phalanx-client` | Multiplayer client: lockstep sync, matchmaking, `PhalanxClient` implements `ITickFrameProvider` |
| `phalanx-server` | Multiplayer server: tick authority, matchmaking, desync detection |

There is an example game — `direct-strike-babylon-example` (an RTS) — that currently has its own `PhysicsSystem`, `PhysicsBodyComponent`, and spatial grid collision detection embedded directly in the game code. The goal is to **extract** this physics functionality into a reusable `phalanx-physics` package.

### Repository

GitHub: `github.com/phaeton2040-AI/phalanx-engine` (monorepo)

---

## Objective

Create the `phalanx-physics` npm package and refactor `direct-strike-babylon-example` to use it as a dependency, ensuring zero behavioral regression.

---

## Part 1: Create `phalanx-physics` Package

### 1.1 Package Setup

Create the package at `packages/phalanx-physics/` following the same structure as existing packages (`phalanx-ecs`, `phalanx-math`):

```
packages/phalanx-physics/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                    # Public API exports
│   ├── components/
│   │   ├── PhysicsBodyComponent.ts # SoA component (extracted from direct-strike)
│   │   └── index.ts
│   ├── collision/
│   │   ├── SpatialHashGrid.ts      # Broad-phase spatial hash grid
│   │   ├── NarrowPhase.ts          # Collision detection algorithms
│   │   ├── CollisionManifold.ts    # Collision result data
│   │   └── index.ts
│   ├── systems/
│   │   ├── PhysicsSystem.ts        # Velocity integration + sub-stepping
│   │   ├── CollisionSystem.ts      # Broad + narrow phase + resolution
│   │   └── index.ts
│   ├── PhysicsWorldConfig.ts       # Configuration interface
│   └── PhysicsWorld.ts             # High-level facade
└── tests/
    ├── SpatialHashGrid.test.ts
    ├── NarrowPhase.test.ts
    ├── PhysicsSystem.test.ts
    └── CollisionSystem.test.ts
```

### 1.2 Dependencies

```json
{
  "name": "phalanx-physics",
  "peerDependencies": {
    "phalanx-ecs": "^x.x.x",
    "phalanx-math": "^x.x.x"
  },
  "devDependencies": {
    "phalanx-ecs": "workspace:*",
    "phalanx-math": "workspace:*"
  }
}
```

**Critical**: `phalanx-ecs` and `phalanx-math` are **peer dependencies**, not bundled dependencies. The package must NOT bundle or re-export them.

### 1.3 PhysicsBodyComponent (SoA)

Extract from `direct-strike-babylon-example/src/components/PhysicsBodyComponent.ts`. This is a SoA component backed by typed arrays for cache-friendly hot-path iteration.

**Current schema in direct-strike:**

```typescript
const PhysicsSoASchema = defineSoASchema({
  velocityX: 'i64',    // BigInt64Array — deterministic fixed-point
  velocityY: 'i64',
  velocityZ: 'i64',
  radius:    'i64',
  mass:      'i64',
  isStatic:  'u8',     // Uint8Array — boolean flag
  ignorePhysics: 'u8',
  lastXZ:    'f64',    // Float64Array
}, 'PhysicsBody');
```

**Modifications for the package:**

- The component must NOT reference any game-specific `ComponentType` registry. Instead, export a `PHYSICS_BODY_COMPONENT_TYPE` symbol that consumers register into their own `ComponentType`.
- Provide a static `soaSchema` accessor for the schema.
- Keep the facade getter/setter API for convenience (`get velocity(): FPVector3Type`, etc.).
- Add a `restitution: 'i64'` field (bounce coefficient, default `FP.From(0.5)`).
- Add a `friction: 'i64'` field (default `FP.From(0.3)`).

**Exported API:**

```typescript
export const PhysicsSoASchema: SoASchema;
export const PHYSICS_BODY_COMPONENT_TYPE: symbol;

export class PhysicsBodyComponent extends SoAComponent<...> {
  constructor(entityId: number, config: PhysicsBodyConfig);
  
  // Facade getters (convenience, not for hot-path)
  get velocity(): FPVector3Type;
  set velocity(v: FPVector3Type);
  get radius(): FixedPoint;
  get mass(): FixedPoint;
  get isStatic(): boolean;
  get ignorePhysics(): boolean;
  get restitution(): FixedPoint;
  get friction(): FixedPoint;
}

export interface PhysicsBodyConfig {
  radius: FixedPoint;
  mass?: FixedPoint;       // default FP.From(1)
  isStatic?: boolean;      // default false
  restitution?: FixedPoint; // default FP.From(0.5)
  friction?: FixedPoint;    // default FP.From(0.3)
}
```

### 1.4 SpatialHashGrid

A deterministic spatial hash grid for broad-phase collision detection.

**Requirements:**

- All math uses `phalanx-math` `FP` operations — fully deterministic.
- Grid cell size is configurable via `FixedPoint`.
- Supports insert, remove, update, and query operations.
- Query returns candidate pairs — entities sharing the same cell or adjacent cells.
- Must handle entity movement between cells efficiently (remove from old cell, insert into new cell).
- Zero garbage collection in hot-path: pre-allocate arrays, reuse buffers.

**API:**

```typescript
export class SpatialHashGrid {
  constructor(cellSize: FixedPoint);
  
  insert(entityId: number, posX: FixedPoint, posZ: FixedPoint, radius: FixedPoint): void;
  remove(entityId: number): void;
  update(entityId: number, posX: FixedPoint, posZ: FixedPoint, radius: FixedPoint): void;
  
  // Returns array of [entityIdA, entityIdB] candidate collision pairs
  // Pairs are deduplicated and sorted (A < B) for determinism
  queryPairs(): [number, number][];
  
  // Query all entities within radius of a point
  queryRadius(posX: FixedPoint, posZ: FixedPoint, radius: FixedPoint): number[];
  
  clear(): void;
}
```

**Implementation notes:**

- Hash function: use a simple integer hash of cell coordinates. Coordinates are computed as `FP.Div(pos, cellSize)` truncated to integer.
- Cell key: combine X and Z cell indices into a single number or use a Map<string, number[]>.
- For `queryPairs()`, iterate all non-empty cells and check neighbor cells (9-cell neighborhood in 2D).
- Pair deduplication: always order pair as `[min(a,b), max(a,b)]` and use a Set.
- Pre-allocate the pairs result array and reuse it between calls.

### 1.5 NarrowPhase

Deterministic narrow-phase collision detection algorithms.

**Supported collision shapes (v1):**

| Shape | Description |
|-------|-------------|
| Circle-Circle | Two spheres projected onto XZ plane |
| Circle-AABB | Circle vs axis-aligned bounding box (for arena walls) |
| AABB-AABB | Two axis-aligned boxes (for static obstacles) |

**API:**

```typescript
export interface CollisionManifold {
  entityA: number;
  entityB: number;
  normalX: FixedPoint;   // Collision normal (A → B direction)
  normalZ: FixedPoint;
  penetration: FixedPoint; // Overlap depth
}

export class NarrowPhase {
  // All methods are static, pure functions, deterministic
  static circleVsCircle(
    posAX: FixedPoint, posAZ: FixedPoint, radiusA: FixedPoint,
    posBX: FixedPoint, posBZ: FixedPoint, radiusB: FixedPoint,
    entityA: number, entityB: number
  ): CollisionManifold | null;
  
  static circleVsAABB(
    circlePosX: FixedPoint, circlePosZ: FixedPoint, circleRadius: FixedPoint,
    aabbMinX: FixedPoint, aabbMinZ: FixedPoint,
    aabbMaxX: FixedPoint, aabbMaxZ: FixedPoint,
    entityCircle: number, entityAABB: number
  ): CollisionManifold | null;
  
  static aabbVsAABB(
    aMinX: FixedPoint, aMinZ: FixedPoint, aMaxX: FixedPoint, aMaxZ: FixedPoint,
    bMinX: FixedPoint, bMinZ: FixedPoint, bMaxX: FixedPoint, bMaxZ: FixedPoint,
    entityA: number, entityB: number
  ): CollisionManifold | null;
}
```

**Critical**: All distance/overlap calculations MUST use `FP.Mul`, `FP.Add`, `FP.Sub`, `FP.Div`, `FP.Sqrt` from `phalanx-math`. No native `Math.*` or floating-point arithmetic in any collision function.

### 1.6 PhysicsSystem (GameSystem)

Extends `GameSystem` from `phalanx-ecs`. Handles velocity integration with sub-stepping.

**Responsibilities:**
- Read velocities from `PhysicsBodyComponent` SoA store
- Read/write positions from `TransformComponent` SoA store (from `phalanx-ecs` — consumer provides the schema)
- Integrate positions: `pos += velocity * dt` per sub-step
- Clamp entities to world bounds (if configured)
- Apply velocity damping/friction per tick

**Key design decision**: `PhysicsSystem` does NOT own `TransformComponent`. The consumer's game already has `TransformComponent` registered. PhysicsSystem must accept a **transform store reference** during initialization rather than creating its own.

**Implementation pattern (direct SoA access for hot-path):**

```typescript
export class PhysicsSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;
  private transformStore!: SoAComponentStore<any>; // Consumer's transform schema
  private config: PhysicsConfig;
  
  constructor(config: PhysicsConfig) { ... }
  
  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    // transformStore must be set by consumer via setTransformStore()
  }
  
  // Consumer calls this to link their TransformComponent SoA store
  public setTransformStore(store: SoAComponentStore<any>, fieldMapping: TransformFieldMapping): void;
  
  public processTick(tick: number): void {
    const subDt = FP.Div(this.config.tickDt, FP.From(this.config.subSteps));
    for (let i = 0; i < this.config.subSteps; i++) {
      this.applyVelocities(subDt);
      // CollisionSystem handles collision detection+resolution between sub-steps
    }
  }
  
  private applyVelocities(dt: FixedPoint): void { ... }
}
```

**TransformFieldMapping** — tells PhysicsSystem which array fields in the consumer's TransformComponent correspond to fpPositionX, fpPositionZ:

```typescript
export interface TransformFieldMapping {
  fpPositionX: string; // field name in consumer's SoA schema, e.g. 'fpPositionX'
  fpPositionY: string;
  fpPositionZ: string;
}
```

### 1.7 CollisionSystem (GameSystem)

Extends `GameSystem`. Handles broad-phase → narrow-phase → resolution pipeline.

**Responsibilities:**
- Rebuild/update `SpatialHashGrid` each tick with current entity positions
- Run broad-phase to get candidate pairs
- Run narrow-phase on candidates to get `CollisionManifold[]`
- Resolve collisions: push apart overlapping entities (impulse-based for dynamic-dynamic, full push for dynamic-static)
- Emit collision events via `EventBus` so game code can react (e.g., enemy hitting player → explosion)

**Collision events emitted:**

```typescript
export const PhysicsEvents = {
  COLLISION: 'physics:collision',
  TRIGGER_ENTER: 'physics:trigger:enter',  // For sensor/trigger colliders
  TRIGGER_EXIT: 'physics:trigger:exit',
} as const;

export interface CollisionEvent {
  entityA: number;
  entityB: number;
  manifold: CollisionManifold;
}
```

**Collision layers (optional but recommended for v1):**

```typescript
export interface CollisionFilter {
  category: number;  // Bitmask: what layer this entity is on
  mask: number;      // Bitmask: what layers this entity collides with
}
```

This allows game code to set up layer rules like:
- Player (layer 1) collides with Enemies (layer 2) and Walls (layer 4)
- Bullets (layer 8) collide with Enemies (layer 2) but not Player (layer 1)
- Pickups (layer 16) collide with Player (layer 1) only

### 1.8 PhysicsWorld Facade

High-level convenience class that wires everything together.

```typescript
export interface PhysicsWorldConfig {
  gridCellSize?: FixedPoint;       // default FP.From(4)
  subSteps?: number;               // default 3
  tickRate?: number;               // default 20 (to compute tickDt)
  worldBounds?: {                  // optional arena bounds
    minX: FixedPoint;
    minZ: FixedPoint;
    maxX: FixedPoint;
    maxZ: FixedPoint;
  };
  defaultRestitution?: FixedPoint; // default FP.From(0.5)
  defaultFriction?: FixedPoint;    // default FP.From(0.3)
}

export class PhysicsWorld {
  constructor(config?: PhysicsWorldConfig);
  
  // Returns systems to register with GameWorld
  getSystems(): { physicsSystem: PhysicsSystem; collisionSystem: CollisionSystem };
  
  // Link consumer's TransformComponent store
  setTransformStore(store: SoAComponentStore<any>, fieldMapping: TransformFieldMapping): void;
  
  // Convenience: subscribe to collision events
  onCollision(callback: (event: CollisionEvent) => void): () => void;
  onTriggerEnter(callback: (event: CollisionEvent) => void): () => void;
  onTriggerExit(callback: (event: CollisionEvent) => void): () => void;
  
  // Direct access to spatial grid for custom queries (e.g., "find enemies within radius")
  get spatialGrid(): SpatialHashGrid;
  
  dispose(): void;
}
```

**Usage example:**

```typescript
import { GameWorld } from 'phalanx-ecs';
import { PhysicsWorld, PhysicsBodyComponent } from 'phalanx-physics';
import { TransformSoASchema } from './components/TransformComponent'; // game's own

const physics = new PhysicsWorld({
  gridCellSize: FP.From(4),
  subSteps: 3,
  tickRate: 20,
  worldBounds: { minX: FP.From(-50), minZ: FP.From(-50), maxX: FP.From(50), maxZ: FP.From(50) },
});

const { physicsSystem, collisionSystem } = physics.getSystems();

world.registerSystems(
  [physicsSystem, collisionSystem, movementSystem, combatSystem, ...],
  [renderSystem, ...]
);

// After GameWorld.start(), link the transform store
const txStore = world.entityManager.getOrCreateSoAStore(TransformSoASchema);
physics.setTransformStore(txStore, {
  fpPositionX: 'fpPositionX',
  fpPositionY: 'fpPositionY',
  fpPositionZ: 'fpPositionZ',
});

// Listen for collisions
physics.onCollision((event) => {
  console.log(`Entity ${event.entityA} hit Entity ${event.entityB}`);
});
```

### 1.9 Public API (index.ts exports)

```typescript
// Components
export { PhysicsBodyComponent, PhysicsSoASchema, PHYSICS_BODY_COMPONENT_TYPE } from './components';
export type { PhysicsBodyConfig } from './components';

// Collision
export { SpatialHashGrid } from './collision/SpatialHashGrid';
export { NarrowPhase } from './collision/NarrowPhase';
export type { CollisionManifold } from './collision/CollisionManifold';

// Systems
export { PhysicsSystem } from './systems/PhysicsSystem';
export { CollisionSystem } from './systems/CollisionSystem';

// Facade
export { PhysicsWorld } from './PhysicsWorld';

// Config & Types
export type { PhysicsWorldConfig } from './PhysicsWorldConfig';
export type { TransformFieldMapping, CollisionFilter, CollisionEvent } from './types';
export { PhysicsEvents } from './events';
```

---

## Part 2: Refactor `direct-strike-babylon-example`

### 2.1 Add Dependency

```json
{
  "dependencies": {
    "phalanx-ecs": "workspace:*",
    "phalanx-math": "workspace:*",
    "phalanx-client": "workspace:*",
    "phalanx-physics": "workspace:*"
  }
}
```

### 2.2 Remove Embedded Physics Code

Delete these files from `direct-strike-babylon-example/src/`:

- `components/PhysicsBodyComponent.ts` — replaced by `phalanx-physics` export
- `systems/PhysicsSystem.ts` — replaced by `phalanx-physics` export
- Any spatial grid / collision detection code embedded in the game

### 2.3 Update ComponentType Registry

In `src/components/Component.ts`, replace the local `PhysicsBody` registration:

```typescript
// BEFORE:
export const ComponentType = createComponentTypeRegistry({
  // ...
  PhysicsBody: 'PhysicsBody',
});

// AFTER:
import { PHYSICS_BODY_COMPONENT_TYPE } from 'phalanx-physics';

export const ComponentType = createComponentTypeRegistry({
  // ...
  PhysicsBody: PHYSICS_BODY_COMPONENT_TYPE, // Use the symbol from phalanx-physics
});
```

### 2.4 Update Imports

Find all files importing from the local physics components/systems and update:

```typescript
// BEFORE:
import { PhysicsBodyComponent } from '../components/PhysicsBodyComponent';
import { PhysicsSystem } from '../systems/PhysicsSystem';

// AFTER:
import { PhysicsBodyComponent, PhysicsSystem } from 'phalanx-physics';
// OR use PhysicsWorld facade:
import { PhysicsWorld } from 'phalanx-physics';
```

### 2.5 Update Game.ts (Thin Orchestrator)

The main `Game.ts` currently creates `PhysicsSystem` manually and registers it. Replace with `PhysicsWorld` facade:

```typescript
// In Game.ts or GameInitializer.ts

import { PhysicsWorld } from 'phalanx-physics';
import { FP } from 'phalanx-math';

// Create PhysicsWorld
this.physicsWorld = new PhysicsWorld({
  gridCellSize: FP.From(4),
  subSteps: networkConfig.physicsSubsteps, // from constants.ts (default 3)
  tickRate: networkConfig.tickRate,         // from constants.ts (default 20)
  worldBounds: {
    minX: FP.From(-arenaParams.width / 2),
    minZ: FP.From(-arenaParams.depth / 2),
    maxX: FP.From(arenaParams.width / 2),
    maxZ: FP.From(arenaParams.depth / 2),
  },
});

const { physicsSystem, collisionSystem } = this.physicsWorld.getSystems();

// Register with GameWorld (order matters for tick systems!)
world.registerSystems(
  [physicsSystem, collisionSystem, movementSystem, combatSystem, ...],
  [interpolationSystem, renderSystem, ...]
);

// Link transform store after world starts
world.start({
  beforeTick: (tick, commands) => {
    // Link transform store on first tick if not done yet
    if (!this.transformStoreLinked) {
      const txStore = world.entityManager.getOrCreateSoAStore(TransformSoASchema);
      this.physicsWorld.setTransformStore(txStore, {
        fpPositionX: 'fpPositionX',
        fpPositionY: 'fpPositionY', 
        fpPositionZ: 'fpPositionZ',
      });
      this.transformStoreLinked = true;
    }
    // ... rest of beforeTick
  },
  // ... other hooks
});
```

### 2.6 Update Entity Creation

All entity classes that add `PhysicsBodyComponent` must be updated to import from `phalanx-physics`:

```typescript
// In any entity file (Unit.ts, Tower.ts, ProjectileEntity.ts, etc.)
import { PhysicsBodyComponent } from 'phalanx-physics';
import { FP } from 'phalanx-math';

// BEFORE (if constructor signature changed):
this.addComponent(new PhysicsBodyComponent(this.id, FP.From(1.0)));

// AFTER (new config-based constructor):
this.addComponent(new PhysicsBodyComponent(this.id, {
  radius: FP.From(1.0),
  mass: FP.From(1),
  isStatic: false,
}));
```

### 2.7 Update CombatSystem / ProjectileSystem

These systems likely access `PhysicsBodyComponent` for radius/collision queries. Update their imports and ensure they work with the new package's component.

If these systems use the spatial grid directly for range queries (e.g., "find enemies within attack range"), they should now use `PhysicsWorld.spatialGrid.queryRadius()` instead of any embedded solution.

### 2.8 Verify StateHasher Compatibility

The `LockstepManager.computeStateHash` method hashes `PhysicsBodyComponent` data. Ensure the field names and SoA schema haven't changed in a way that breaks hashing. The hash must include:

- velocity (from PhysicsBodyComponent SoA store)
- radius (from PhysicsBodyComponent SoA store)

Verify determinism: same input → same hash → no desync.

---

## Part 3: Testing & Validation

### 3.1 Unit Tests for `phalanx-physics`

Write tests for each module:

**SpatialHashGrid tests:**
- Insert entities, verify `queryPairs()` returns correct pairs
- Move entity to new cell, verify old cell no longer contains it
- `queryRadius()` returns only entities within range
- Determinism: same operations → same output every time
- Edge case: two entities at exact same position
- Edge case: entity on cell boundary

**NarrowPhase tests:**
- Circle-circle: overlapping, touching, separated
- Circle-AABB: overlap, touching, separated, corner case
- All functions return null for non-colliding shapes
- Collision normal points from A to B
- Penetration depth is correct

**PhysicsSystem tests:**
- Velocity integration moves entities correctly
- Sub-stepping produces stable results
- Static entities don't move
- `ignorePhysics` flag skips entity
- World bounds clamping works

**CollisionSystem tests:**
- Two circles colliding are pushed apart
- Static vs dynamic: only dynamic moves
- Collision events are emitted via EventBus
- Collision layers filter correctly

### 3.2 Integration Test (direct-strike)

After refactoring, the RTS game must:

- **Boot without errors** — lobby scene loads, connects to server
- **Units collide correctly** — same behavior as before extraction
- **Projectiles interact with physics** — same collision detection
- **No desync** — if two clients play, state hashes must match (physics is still deterministic)
- **Performance** — no regression in tick processing time (measure `processTick` duration before and after)

### 3.3 Regression Checklist

- [ ] All entity types spawn with `PhysicsBodyComponent` from `phalanx-physics`
- [ ] `PhysicsSystem.processTick` runs each tick with correct sub-stepping
- [ ] `CollisionSystem` detects all collisions that the old embedded code detected
- [ ] Collision events reach `CombatSystem` and `ProjectileSystem`
- [ ] Entity positions are clamped to arena bounds
- [ ] State hashing includes physics data (no desync)
- [ ] `PhysicsBodyComponent` SoA store is created lazily on first component construction
- [ ] `dispose()` cleans up all resources
- [ ] Build succeeds (`npm run build` in monorepo root)
- [ ] Existing tests pass
- [ ] New unit tests pass

---

## Constraints & Guidelines

### Determinism (CRITICAL)

- ALL physics math MUST use `FP.*` functions from `phalanx-math`
- NEVER use `Math.*`, native `+`/`-`/`*`/`/` on physics values, or floating-point arithmetic in simulation code
- Entity iteration MUST be sorted by entity ID for deterministic ordering
- No `Date.now()`, `Math.random()`, or any non-deterministic API in tick logic

### Performance

- Hot-path code (velocity integration, collision detection) MUST use direct SoA store array access — NOT component facade getters
- Cache `store.arrays.*` references outside loops
- Pre-allocate collision pair arrays, manifold objects — minimize GC pressure
- `SpatialHashGrid` should reuse internal buffers between ticks

### API Design

- The package is **renderer-agnostic** — no Babylon.js, Three.js, or any rendering imports
- The package is **network-agnostic** — no `PhalanxClient` dependency
- `GameSystem` and `SoAComponent` come from `phalanx-ecs` peer dependency
- `FP`, `FPVector3`, `FixedPoint` come from `phalanx-math` peer dependency
- All public types must be exported
- JSDoc comments on all public API methods

### Compatibility

- TypeScript strict mode
- ES2020 target (BigInt support required for `i64` fields)
- No Node.js-specific APIs (must work in browser)

---

## Execution Order

1. **Scaffold** `packages/phalanx-physics/` with `package.json`, `tsconfig.json`
2. **Implement** `PhysicsBodyComponent` (extract + extend with restitution/friction)
3. **Implement** `SpatialHashGrid` (broad-phase)
4. **Implement** `NarrowPhase` (circle-circle, circle-AABB, AABB-AABB)
5. **Implement** `CollisionManifold` type and `PhysicsEvents`
6. **Implement** `PhysicsSystem` (velocity integration, sub-stepping, bounds clamping)
7. **Implement** `CollisionSystem` (pipeline: grid update → broad → narrow → resolve → emit)
8. **Implement** `PhysicsWorld` facade
9. **Write** unit tests for all modules
10. **Refactor** `direct-strike-babylon-example`:
    - Add `phalanx-physics` dependency
    - Delete local physics files
    - Update all imports
    - Update `Game.ts` to use `PhysicsWorld`
    - Update entity classes
    - Verify build + runtime
11. **Run** full regression test
12. **Write** `README.md` for `phalanx-physics` with usage examples

---

## Notes for Implementation

### TransformComponent Ownership

`TransformComponent` stays in the consumer's game code (or could eventually move to `phalanx-ecs` itself). `phalanx-physics` does NOT define or own `TransformComponent`. Instead, it accepts a reference to the consumer's transform SoA store via `setTransformStore()` with a field mapping. This keeps physics decoupled from any specific transform schema.

### System Execution Order

In `GameWorld.registerSystems()`, tick system order matters. The recommended order for physics is:

```
1. [Game logic systems: MovementSystem, EnemyAISystem, WeaponSystem, etc.]
   → These set velocities on PhysicsBodyComponent
2. PhysicsSystem
   → Integrates velocities into positions (with sub-stepping)
3. CollisionSystem
   → Detects and resolves collisions, emits events
4. [Reaction systems: CombatSystem, HealthSystem, etc.]
   → React to collision events
```

### Spatial Grid Cell Size Tuning

The `gridCellSize` should be approximately 2× the largest entity radius in the game. Too small → entities span many cells (expensive). Too large → too many candidates per cell (expensive narrow-phase). Document this in the README.

### Future Extensions (NOT in v1)

These are explicitly out of scope for the initial extraction but should be kept in mind for API design:

- Raycasting (needed for bullet traces)
- Trigger volumes (enter/exit callbacks without physical response)
- Quadtree alternative broad-phase
- 3D collision (Y-axis)
- Joints/constraints
- Continuous collision detection (CCD)
