# @phalanx-engine/physics

Deterministic physics for lockstep games. Positions, velocities, and
collision response are fixed-point, so two peers that run the same ticks
separate the same bodies by the same amounts.

The pipeline is two-dimensional on XZ. Height is a velocity the integrator
applies on Y. A building hit uses a swept-segment query against boxes you
supply.

```bash
pnpm add @phalanx-engine/physics
```

Peers: `@phalanx-engine/ecs`, `@phalanx-engine/math`. Games import this
package through `@phalanx-engine/game/physics`.

## Quick start

`PhysicsWorld.attach(world)` is the setup. Call it before
`world.start()`.

```ts
import { GameWorld, GameSystem } from '@phalanx-engine/ecs';
import { FP, FPVector3 } from '@phalanx-engine/math';
import {
  Physics,
  PhysicsWorld,
  attachPhysicsBody,
  attachTransform,
  setVelocity,
} from '@phalanx-engine/physics';

const world = new GameWorld({ tickFrameProvider });
const physics = new PhysicsWorld({
  gridCellSize: FP.FromFloat(8),
  subSteps: 3,
  tickRate: 20,
});
physics.attach(world);

world.addSystem(new MovementSystem(), { phase: 'input' });
world.addSystem(new RenderSystem(), { phase: 'render' });
world.start();

const entity = world.createEntity();
attachTransform(entity, FPVector3.FromFloat(0, 0, 0));
attachPhysicsBody(entity, { radius: FP.FromFloat(1) });
setVelocity(entity, FP.FromFloat(2), FP._0, FP._0);

physics.onCollision((event) => {
  react(event.entityA, event.entityB);
});
```

Subscribe to `onCollision` and `onBoundsExit` after `world.start()`.
Earlier throws. `TRIGGER_ENTER` and `TRIGGER_EXIT` are reserved and are
not emitted.

## What `attach` wires

One call, in this order:

1. Registers `Transform`, `PhysicsBody`, and transient `Interpolation`.
   The two SoA components are saved and included in `configHash`.
   `Interpolation` is display samples: not saved, not hashed.
2. Provides the `Physics` service (`defineService`), so
   `world.context.getService(Physics)` is this `PhysicsWorld`.
3. Adds `GravitySystem`, then `PhysicsSystem` (`after: 'GravitySystem'`),
   to the `physics` tick phase.
4. Adds `InterpolationSystem` to the `interpolation` frame phase.
5. Registers save section `physics.broadphase` (version 1).

A second `attach` of the same world does nothing. A different world
throws. Do not register `Transform`, `PhysicsBody`, or `Interpolation`
again yourself.

Movement that writes velocity runs in `input`, before the physics phase.
A system that must see the integrated positions uses
`after: 'PhysicsSystem'` or the `late` phase.

`PhysicsSystem.step()` is for tests and tools. A running world advances
physics on the tick.

## Helpers

Wrapper classes are gone. These functions take the entity. Reads return
shared scratch. Copy the values before the next read.

| Function                                                      | Role                          |
| ------------------------------------------------------------- | ----------------------------- |
| `attachTransform(entity, position?, rotation?)`               | SoA position and quaternion   |
| `readFpPosition(entity)` / `writeFpPosition(entity, value)`   | Authoritative position        |
| `readFpRotation` / `writeFpRotation` / `readYaw` / `writeYaw` | Orientation                   |
| `attachPhysicsBody(entity, config)`                           | Velocity, radius, mass, flags |
| `readVelocity(entity)` / `setVelocity(entity, x, y, z)`       | Body velocity                 |
| `addVelocity` / `stopVelocity`                                | Accumulate or zero            |
| `attachInterpolation(entity, position?, rotation?)`           | Render samples                |

`readBroadphase` attaches `Interpolation` to every entity that has
`Transform` and `PhysicsBody`, seeded from the transform.
`InterpolationSystem.afterTick` snapshots, then captures.
`beforeFrame` interpolates. Tick code must not branch on
`Interpolation`.

```ts
const position = readFpPosition(entity);
const copy = { x: position.x, y: position.y, z: position.z };
writeFpPosition(entity, copy);
setVelocity(entity, FP.FromFloat(1), FP._0, FP._0);
```

`PhysicsBody` fields: `velocityX/Y/Z`, `radius`, `mass`, `restitution`,
`friction`, `isStatic`, `ignorePhysics`, `useGravity`,
`gravityMultiplier`. There is no display-float cache on the body.

```ts
attachPhysicsBody(entity, {
  radius: FP.FromFloat(0.4),
  mass: FP._1,
  isStatic: false,
  restitution: FP.FromFloat(0.5),
  friction: FP._0,
  useGravity: false,
  gravityMultiplier: FP._1,
});
```

A missing SoA row (`indexOf(entityId) === -1`) returns early. Invalid
configuration throws from the constructor.

For a hot loop, read the arrays by the row from `world.query`:

```ts
for (const [, row] of world.query(PhysicsBody, Transform)) {
  const vx = physicsStore.arrays.velocityX[row];
  if (vx === undefined) continue;
  physicsStore.arrays.velocityX[row] = vx;
}
```

## Collisions-only mode

`integrate: false` separates overlaps and leaves movement to the game.
One pass per tick. Sub-steps, friction, `maxVelocity`, and `worldBounds`
do not apply.

```ts
const physics = new PhysicsWorld({
  integrate: false,
  collisionResponse: 'push',
  pushStrength: FP.FromFloat(15),
});
```

`'push'` writes a velocity of `overlap × pushStrength` and does not
integrate it into position. `'impulse'` keeps restitution. `GravitySystem`
still runs and writes `velocity.y`. The push velocity is not cleared, so
`isSettled` means something only if the game zeros velocity itself.

## Collision response

`collisionResponse` defaults to `'push'`.

| Mode        | What happens                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'push'`    | Positional separation plus a mass-weighted push scaled by `pushStrength`. Stable for crowds and characters.                                                 |
| `'impulse'` | Momentum along the contact normal, `j = (1 + e) · vₙ / (1/mₐ + 1/m_b)`, skipped when the bodies are already separating. XZ only. `velocityY` is left alone. |

`e` is `config.restitution` when set, otherwise the average of the two
bodies. Static bodies are infinite mass.

```ts
const physics = new PhysicsWorld({
  collisionResponse: 'impulse',
  restitution: FP.FromFloat(0.85),
});
```

`setCollisionFilter((entityA, entityB) => boolean)` skips a pair when it
returns false.

## Gravity

Off by default (`gravity` is 0). Opt in for arcs: shells, grenades,
anything that leaves the ground.

`GravitySystem` accelerates. For `useGravity` bodies it does
`velocityY -= gravity * tickDt * gravityMultiplier` and never writes
position. `PhysicsSystem` is the only integrator, on all three axes.
`gravityAxis` is `'y'`. `'x'` and `'z'` throw, because those axes already
belong to the integrator.

`maxVelocity` and `worldBounds` stay on XZ. A body with `velocityY = 0`
does not move on Y.

```ts
const physics = new PhysicsWorld({
  gravity: FP.FromFloat(9.81),
  tickRate: 20,
});

attachPhysicsBody(shell, {
  radius: FP.FromFloat(0.2),
  mass: FP._1,
  friction: FP._1,
  useGravity: true,
  gravityMultiplier: FP.FromFloat(2),
});

physics.applyImpulse3D(
  shell.id,
  FP.FromFloat(6),
  FP.FromFloat(8),
  FP.FromFloat(-3)
);
```

`applyImpulse(entityId, vx, vz)` sets XZ velocity directly and does not
divide by mass. `applyImpulse3D` applies momentum: `velocity = impulse /
mass` on all three axes. Mass `<= 0` is unchanged. Both clear
`ignorePhysics`.

`isSettled(threshold?)` is true when every non-static, non-ignored body
is under the threshold (default `FP.FromFloat(0.01)`), counting X, Y, and
Z.

Gravity runs once per world tick. The physics step may sub-step. That
same `velocityY` is integrated on every sub-step.

## Raycasts

The body pipeline does not collide on Y. For a point moving through a
box, pass the previous position, the current position, and the boxes:

```ts
const hit = physics.raycastSegment(prevPos, curPos, buildingBoxes);
if (hit) {
  detonateAt(hit.point, hit.normal);
}
```

`hit.t` is 0 at `prev` and 1 at `cur`. `hit.point` is the fixed-point
impact. `hit.normal` is the outward face normal. A segment that starts
inside a box returns `t = 0`. The query is a linear scan of the boxes
you pass. The moving body is a point; inflate the box by the radius when
you need a margin. `segmentVsAABB` tests one box.

`getInterpolatedTransform(entityId)` is for frame systems, after
`InterpolationSystem.beforeFrame`. It returns float `position` and a
float quaternion `rotation`. Those floats must not flow back into the
simulation.

## Events

```ts
const PhysicsEvents = {
  COLLISION: 'physics:collision',
  TRIGGER_ENTER: 'physics:trigger:enter',
  TRIGGER_EXIT: 'physics:trigger:exit',
  BOUNDS_EXIT: 'physics:bounds:exit',
} as const;
```

`BOUNDS_EXIT` requires `ejectOnBoundsExit: true`. The body is marked
ignored instead of clamped.

## Config

```ts
interface PhysicsWorldConfig {
  gridCellSize?: FixedPoint; // default FP.FromFloat(4)
  subSteps?: number; // default 3
  tickRate?: number; // default 20
  worldBounds?: {
    minX: FixedPoint;
    minZ: FixedPoint;
    maxX: FixedPoint;
    maxZ: FixedPoint;
  };
  defaultFriction?: FixedPoint; // default FP.FromFloat(0.92)
  maxVelocity?: FixedPoint; // default FP.FromFloat(15)
  pushStrength?: FixedPoint; // default FP.FromFloat(15)
  collisionResponse?: 'push' | 'impulse'; // default 'push'
  restitution?: FixedPoint;
  integrate?: boolean; // default true
  ejectOnBoundsExit?: boolean; // default false
  settleThreshold?: FixedPoint; // default FP.FromFloat(0.01)
  gravity?: FixedPoint; // default 0
  gravityAxis?: 'x' | 'y' | 'z'; // only 'y' is accepted
}
```

`spatialGrid` is the broad-phase hash. `queryPairs()` and
`queryRadius()` return reused, already-sorted buffers. Consume them
before the next call.

Narrow phase covers circle/circle, circle/AABB, and AABB/AABB. A manifold
is `{ entityA, entityB, normalX, normalZ, penetration }`.

## License

MIT
