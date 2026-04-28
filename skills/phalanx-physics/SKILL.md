---
name: phalanx-physics
description: Add deterministic fixed-point physics to a game using the phalanx-physics library from the phalanx-engine repository. Use when the user wants to set up collision detection, velocity integration, spatial hashing, or physics bodies. Covers PhysicsWorld facade, PhysicsBodyComponent, SpatialHashGrid, NarrowPhase, PhysicsSystem (which runs the full broad → narrow → resolve pipeline), TransformFieldMapping, and collision filtering patterns.
metadata:
  author: phaeton2040-AI
  version: '1.0'
---

# Phalanx Physics Skill

## When to Use This Skill

Use this skill when the user asks to:

- Add physics to a game using phalanx-physics
- Create physics bodies with radius, mass, velocity, or collision properties
- Set up collision detection (broad-phase or narrow-phase)
- Configure a PhysicsWorld with sub-stepping and velocity integration
- Implement deterministic collision resolution for lockstep multiplayer
- Add game-specific collision filtering (e.g., team-based rules)
- Query entities by spatial proximity (range queries)
- Wire physics systems into a GameWorld tick pipeline

## Prerequisites

- TypeScript project with strict mode
- `phalanx-ecs` package (peer dependency — GameSystem, SoAComponent, EntityManager, EventBus)
- `phalanx-math` package (peer dependency — FP.*, FixedPoint, FPVector3)
- A consumer-defined TransformComponent with SoA schema containing `fpPositionX/Y/Z` (`i64`) fields

## Architecture Overview

```
PhysicsWorld (Facade)
└── PhysicsSystem        ← Velocity integration + collision pipeline (sub-stepped)
    ├── SpatialHashGrid  ← O(n) broad-phase via spatial hashing
    └── NarrowPhase      ← Circle vs Circle / AABB collision tests
```

Pipeline per tick (all deterministic, fixed-point), all driven by a single `PhysicsSystem.processTick()`:
```
MovementSystem (game-specific, sets velocities)
    ↓
PhysicsSystem.processTick()
    for each sub-step:
      → integrate velocities into positions
      → rebuild spatial grid
      → query candidate pairs
      → narrow-phase circle-circle / AABB tests
      → resolve: impulse push + positional separation
      → emit PhysicsEvents.COLLISION / TRIGGER_* / BOUNDS_EXIT via EventBus
```

### Key Design Decisions

- **Deterministic**: All math uses `FP.*` fixed-point operations — no `Math.*`, no native float arithmetic on physics values
- **SoA storage**: `BigInt64Array` for FixedPoint values, `Uint8Array` for flags, `Float64Array` for cached floats
- **Entity iteration**: Always sorted by ID for lockstep determinism
- **Transform agnostic**: Physics does NOT own position data — consumers link their own TransformComponent SoA store via `setTransformStore()`
- **Collision filtering**: Game-specific logic injected via `setCollisionFilter()` callback — no coupling to game concepts
- **Visual position sync**: Optional `visualPositionX/Z` fields in `TransformFieldMapping` sync f64 visual caches alongside i64 authoritative positions

## Step-by-Step Instructions

### 1. Install and Set Up PhysicsWorld

```typescript
import { PhysicsWorld } from 'phalanx-physics';
import { FP } from 'phalanx-math';

const physicsWorld = new PhysicsWorld({
  gridCellSize: FP.FromFloat(8),    // Spatial hash cell size (>= 2 * maxRadius)
  subSteps: 3,                       // Physics sub-steps per tick
  tickRate: 20,                      // Tick rate in Hz (used to compute tickDt)
  maxVelocity: FP.FromFloat(15.0),  // Maximum velocity magnitude
  pushStrength: FP.FromFloat(15.0), // Collision push force multiplier

  // Optional: clamp positions to arena bounds
  worldBounds: {
    minX: FP.FromFloat(-50),
    minZ: FP.FromFloat(-50),
    maxX: FP.FromFloat(50),
    maxZ: FP.FromFloat(50),
  },
});
```

### 2. Register Systems with GameWorld

```typescript
import { GameWorld } from 'phalanx-ecs';

const world = new GameWorld({ /* ... */ });

// Extract the system from the facade. PhysicsWorld owns a single
// PhysicsSystem that runs the full broad → narrow → resolve pipeline
// each tick (with sub-stepping internally).
const { physicsSystem } = physicsWorld.getSystems();

// Register in tick system order — ORDER MATTERS:
// 1. Game-specific system sets velocities (e.g., MovementSystem)
// 2. PhysicsSystem integrates velocities, detects, and resolves collisions
// 3. Game-specific systems react to the updated positions
const tickSystems = [
  movementSystem,    // Game-specific: sets velocities on PhysicsBodyComponent
  physicsSystem,     // phalanx-physics: integrate + collide + resolve
  combatSystem,      // Game-specific: reacts to updated positions
];

world.registerSystems(tickSystems, frameSystems);
```

### 3. Link the Transform Store

Physics needs to read/write positions from the consumer's TransformComponent SoA store. Link it in the `beforeTick` hook on the first tick (after stores are created):

```typescript
import { TransformSoASchema } from '../components';
import type { SoASchemaDefinition, SoAComponentStore } from 'phalanx-ecs';

world.start({
  beforeTick: (tick, commands) => {
    if (tick === 0) {
      const txStore = world.entityManager.getOrCreateSoAStore(TransformSoASchema);
      physicsWorld.setTransformStore(
        txStore as unknown as SoAComponentStore<SoASchemaDefinition>,
        {
          fpPositionX: 'fpPositionX',
          fpPositionY: 'fpPositionY',
          fpPositionZ: 'fpPositionZ',
          // Optional: sync visual position cache alongside fp positions
          visualPositionX: 'visualPositionX',
          visualPositionZ: 'visualPositionZ',
        },
      );
    }
    // ... other beforeTick logic
  },
});
```

**Important:** The `visualPositionX/Y/Z` fields are optional. When provided, `PhysicsSystem` writes `FP.ToFloat()` values to these f64 arrays whenever it updates fp positions. This is critical when game systems (like CombatSystem) read visual positions during ticks.

### 4. Create PhysicsBodyComponent for Entities

```typescript
import { PhysicsBodyComponent } from 'phalanx-physics';
import { FP } from 'phalanx-math';

// Dynamic unit with radius 1.0 and mass 1.0
const body = new PhysicsBodyComponent(entity.id, {
  radius: FP.FromFloat(1.0),
  mass: FP.FromFloat(1.0),       // default: FP._1
  isStatic: false,                // default: false
  restitution: FP.FromFloat(0.5), // default: FP.FromFloat(0.5)
  friction: FP.FromFloat(0.3),    // default: FP.FromFloat(0.3)
});
entity.addComponent(body);

// Static building with radius 2.0
const buildingBody = new PhysicsBodyComponent(building.id, {
  radius: FP.FromFloat(2.0),
  mass: FP.FromFloat(10.0),
  isStatic: true,
});
building.addComponent(buildingBody);
```

### 5. Register PhysicsBody Component Type

The `PhysicsBodyComponent` uses a canonical symbol (`PHYSICS_BODY_COMPONENT_TYPE`) that must be registered in your game's `ComponentType` registry:

```typescript
import { createComponentTypeRegistry } from 'phalanx-ecs';
import { PHYSICS_BODY_COMPONENT_TYPE } from 'phalanx-physics';

export const ComponentType = createComponentTypeRegistry({
  // ... other types
  PhysicsBody: 'PhysicsBody', // Include in registry for TypeScript types
});

// Override with canonical symbol at runtime
(ComponentType as Record<string, symbol>).PhysicsBody = PHYSICS_BODY_COMPONENT_TYPE;
```

### 6. Set Velocities in a Game-Specific System

Physics does NOT set velocities — that's the game's responsibility. Your movement system runs BEFORE PhysicsSystem and writes velocities to the PhysicsBody SoA store:

```typescript
import { GameSystem, type SoAComponentStore, type SystemContext } from 'phalanx-ecs';
import { PhysicsSoASchema } from 'phalanx-physics';
import { FP } from 'phalanx-math';

class MovementSystem extends GameSystem {
  private physicsStore!: SoAComponentStore<typeof PhysicsSoASchema.definition>;

  public override init(context: SystemContext): void {
    super.init(context);
    this.physicsStore = this.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
  }

  public override processTick(_tick: number): void {
    const physVelocityX = this.physicsStore.arrays.velocityX;
    const physVelocityZ = this.physicsStore.arrays.velocityZ;
    const zeroRaw = FP.ToRaw(FP._0);

    for (const entityId of this.physicsStore.entityIds()) {
      const physIndex = this.physicsStore.indexOf(entityId);

      // Skip static bodies
      if (this.physicsStore.arrays.isStatic[physIndex] === 1) continue;

      const entity = this.entityManager.getEntity(entityId);
      if (!entity) continue;

      // Game-specific: calculate desired velocity based on movement target
      const movement = entity.getComponent<MovementComponent>(ComponentType.Movement);
      if (movement?.isMoving) {
        // Calculate direction, set velocity...
        const speed = FP.FromFloat(movement.speed);
        physVelocityX[physIndex] = FP.ToRaw(FP.Mul(directionX, speed));
        physVelocityZ[physIndex] = FP.ToRaw(FP.Mul(directionZ, speed));
      } else {
        physVelocityX[physIndex] = zeroRaw;
        physVelocityZ[physIndex] = zeroRaw;
      }
    }
  }
}
```

### 7. Add Collision Filtering (Optional)

For game-specific collision rules (e.g., skip same-team collisions), use the collision filter callback on the `PhysicsWorld` facade (it forwards to the underlying `PhysicsSystem`):

```typescript
physicsWorld.setCollisionFilter((entityIdA: number, entityIdB: number) => {
  const eA = entityManager.getEntity(entityIdA);
  const eB = entityManager.getEntity(entityIdB);
  if (!eA || !eB) return false;

  // Skip collisions between same-team entities when one is static
  const bodyA = eA.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);
  const bodyB = eB.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody);

  if (bodyA?.isStatic || bodyB?.isStatic) {
    const teamA = eA.getComponent<TeamComponent>(ComponentType.Team);
    const teamB = eB.getComponent<TeamComponent>(ComponentType.Team);
    if (teamA && teamB && teamA.team === teamB.team) {
      return false; // skip
    }
  }
  return true; // allow collision
});
```

### 8. Subscribe to Collision Events

```typescript
// Via PhysicsWorld facade (after world.start())
physicsWorld.onCollision((event) => {
  console.log(`Collision: ${event.entityA} ↔ ${event.entityB}`);
  console.log(`Penetration: ${FP.ToFloat(event.manifold.penetration)}`);
});

// Or directly via EventBus
import { PhysicsEvents } from 'phalanx-physics';
eventBus.on(PhysicsEvents.COLLISION, (event) => { /* ... */ });
```

### 9. Spatial Queries (Range Finding)

Use the spatial grid directly for custom proximity queries:

```typescript
const grid = physicsWorld.spatialGrid;

// Find all entities within radius of a position
const nearby = grid.queryRadius(
  FP.FromFloat(10), // centerX
  FP.FromFloat(20), // centerZ
  FP.FromFloat(5),  // search radius
);

// Returns number[] of entity IDs within range
for (const entityId of nearby) {
  // Process nearby entity
}
```

## PhysicsSoASchema Fields

| Field           | Type  | TypedArray       | Description                           |
| --------------- | ----- | ---------------- | ------------------------------------- |
| `velocityX`     | `i64` | `BigInt64Array`  | X velocity (raw FixedPoint)           |
| `velocityY`     | `i64` | `BigInt64Array`  | Y velocity (raw FixedPoint)           |
| `velocityZ`     | `i64` | `BigInt64Array`  | Z velocity (raw FixedPoint)           |
| `radius`        | `i64` | `BigInt64Array`  | Collision radius (raw FixedPoint)     |
| `mass`          | `i64` | `BigInt64Array`  | Entity mass (raw FixedPoint)          |
| `restitution`   | `i64` | `BigInt64Array`  | Bounce factor (raw FixedPoint)        |
| `friction`      | `i64` | `BigInt64Array`  | Surface friction (raw FixedPoint)     |
| `isStatic`      | `u8`  | `Uint8Array`     | 1 = immovable, 0 = dynamic           |
| `ignorePhysics` | `u8`  | `Uint8Array`     | 1 = skip all physics, 0 = active     |
| `lastX`         | `f64` | `Float64Array`   | Cached float X position               |
| `lastZ`         | `f64` | `Float64Array`   | Cached float Z position               |

## TransformFieldMapping

```typescript
interface TransformFieldMapping {
  fpPositionX: string;       // Required: i64 field name for X position
  fpPositionY: string;       // Required: i64 field name for Y position
  fpPositionZ: string;       // Required: i64 field name for Z position
  visualPositionX?: string;  // Optional: f64 field to sync with FP.ToFloat(fpX)
  visualPositionY?: string;  // Optional: f64 field to sync with FP.ToFloat(fpY)
  visualPositionZ?: string;  // Optional: f64 field to sync with FP.ToFloat(fpZ)
}
```

When `visualPositionX/Z` are provided, PhysicsSystem writes the float equivalent alongside every fp position update. This avoids stale visual caches between ticks.

## PhysicsWorldConfig

```typescript
interface PhysicsWorldConfig {
  gridCellSize?: FixedPoint;   // Spatial hash cell size (default: FP.FromFloat(4))
  subSteps?: number;           // Sub-steps per tick (default: 3)
  tickRate?: number;           // Hz, computes tickDt = 1/tickRate (default: 20)
  maxVelocity?: FixedPoint;    // Velocity clamp (default: FP.FromFloat(15))
  pushStrength?: FixedPoint;   // Collision push force (default: FP.FromFloat(15))
  worldBounds?: {              // Optional position clamping
    minX: FixedPoint;
    minZ: FixedPoint;
    maxX: FixedPoint;
    maxZ: FixedPoint;
  };
  defaultRestitution?: FixedPoint; // Default body restitution
  defaultFriction?: FixedPoint;    // Default body friction
}
```

## Collision Pipeline Detail

### Broad Phase — SpatialHashGrid

Divides the world into fixed-size cells. Each entity is inserted into all cells its bounding circle overlaps. `queryPairs()` returns deduplicated, sorted `[entityIdA, entityIdB][]` pairs — deterministic by construction.

```typescript
const grid = new SpatialHashGrid(FP.FromFloat(8));

grid.insert(entityId, posX, posZ, radius);  // Insert/update an entity
grid.remove(entityId);                       // Remove an entity
grid.update(entityId, posX, posZ, radius);   // Remove + re-insert
grid.queryPairs();                           // All overlapping pairs
grid.queryRadius(cx, cz, r);                 // Entities within radius
grid.clear();                                // Remove all
```

### Narrow Phase — NarrowPhase

Static methods for precise collision tests. All use fixed-point math.

```typescript
import { NarrowPhase } from 'phalanx-physics';

// Circle vs Circle
const manifold = NarrowPhase.circleVsCircle(
  posAX, posAZ, radiusA,
  posBX, posBZ, radiusB,
  entityIdA, entityIdB
);

// Circle vs AABB
const manifold2 = NarrowPhase.circleVsAABB(
  circlePosX, circlePosZ, circleRadius,
  aabbMinX, aabbMinZ, aabbMaxX, aabbMaxZ,
  circleEntityId, aabbEntityId
);

// AABB vs AABB
const manifold3 = NarrowPhase.aabbVsAABB(
  aMinX, aMinZ, aMaxX, aMaxZ,
  bMinX, bMinZ, bMaxX, bMaxZ,
  entityIdA, entityIdB
);
```

Returns `CollisionManifold | null`:
```typescript
interface CollisionManifold {
  entityA: number;
  entityB: number;
  normalX: FixedPoint;    // Collision normal (A → B)
  normalZ: FixedPoint;
  penetration: FixedPoint; // Overlap depth
}
```

### Resolution

PhysicsSystem applies, per sub-step, after broad/narrow detection:
1. **Impulse-based push**: Velocity change proportional to mass ratio × overlap × pushStrength
2. **Positional separation**: Direct position correction to prevent overlap (half each side, weighted by mass)

Static entities are never moved. When one entity is static, the dynamic entity absorbs the full push.

## Exports from phalanx-physics

```typescript
// Components
import {
  PhysicsBodyComponent,
  PhysicsSoASchema,
  PHYSICS_BODY_COMPONENT_TYPE,
} from 'phalanx-physics';
import type { PhysicsBodyConfig } from 'phalanx-physics';

// Collision primitives
import { SpatialHashGrid, NarrowPhase } from 'phalanx-physics';
import type { CollisionManifold } from 'phalanx-physics';

// System (single system runs the full pipeline)
import { PhysicsSystem } from 'phalanx-physics';

// Facade
import { PhysicsWorld } from 'phalanx-physics';

// Tick providers
import {
  AutonomousPhysicsTickProvider,
  ExternalPhysicsTickProvider,
} from 'phalanx-physics';
import type {
  IPhysicsTickProvider,
  AutonomousProviderOptions,
} from 'phalanx-physics';

// Events & types
import { PhysicsEvents } from 'phalanx-physics';
import type {
  PhysicsWorldConfig,
  TransformFieldMapping,
  CollisionFilter,
  CollisionEvent,
  BoundsExitEvent,
  PhysicsConfig,
} from 'phalanx-physics';
```

> Note: `CollisionSystem` is **not** exported. The collision pipeline is implemented inside `PhysicsSystem` and only exposed via `PhysicsWorld.getSystems().physicsSystem`.

## Best Practices

### Deterministic Lockstep Rules

- Use `FP.*` functions for ALL physics arithmetic — never native `Math.*` or float operators
- Use `FP.ToRaw()` / `FP.FromRaw()` when writing/reading i64 SoA fields
- Iterate `physicsStore.entityIds()` for deterministic entity ordering
- Never use `Math.random()`, `Date.now()`, or `performance.now()` in physics logic
- Set `gridCellSize` to at least `2 * maxEntityRadius` for correct broad-phase coverage

### Performance

- Cache SoA array references outside loops: `const velX = store.arrays.velocityX`
- Bypass the PhysicsBodyComponent facade in hot-path systems — access SoA arrays directly
- Use cross-store lookups (`store.indexOf(entityId)`) sparingly — one per entity per loop
- Set `ignorePhysics = 1` for dying/phasing entities instead of removing the component (avoids store resize)

### Integration

- A single `PhysicsSystem` runs the full pipeline: it integrates velocities, then detects and resolves collisions, per sub-step
- Game-specific velocity logic (movement, friction) runs BEFORE PhysicsSystem in the tick order
- Link the transform store on the first tick (in `beforeTick`), not at construction time
- Always provide `visualPositionX/Z` in the field mapping when game systems read visual positions during ticks
- Use `setCollisionFilter()` for game-specific rules — keeps phalanx-physics decoupled from game concepts
- Call `physicsWorld.dispose()` when tearing down the game to clean up EventBus subscriptions
