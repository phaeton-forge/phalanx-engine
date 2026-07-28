# GitHub Copilot Instructions — Phalanx Engine

**Read [`../AGENTS.md`](../AGENTS.md) first. It is the authoritative, normative
rules file for this repository.** This file is a short summary only; where the
two disagree, `AGENTS.md` wins.

## Context

TypeScript pnpm monorepo implementing a **deterministic lockstep** multiplayer
game engine. Packages: `math`, `physics`, `ecs`, `abilities`, `client`,
`server`. Node `>=24 <25`, pnpm `10.33.2`, pure ESM.

## The rules you must never break

1. **Determinism.** On the tick path: no `Math.random()`, no `Date.now()`/
   `performance.now()`, no native `Math.*`, no float arithmetic on simulation
   values, no unordered `Map`/`Set` iteration, no renderer/DOM/IO access.
2. **Fixed point.** Simulation values are `FixedPoint` via `FP.*`,
   `FPVector2/3`, `FPQuaternion`. SoA storage is `'i64'`; `FP.ToRaw` on write,
   `FP.FromRaw` on read. `FP.Div` throws on zero — guard it. `FP.FromFloat` is
   expensive: hoist it out of loops. `FP.ToFloat` is presentation-only.
3. **Tick vs frame.** `processTick()` mutates simulation state; `update(dt)` and
   frame hooks are presentation-only and read-only w.r.t. simulation.
4. **ECS discipline.** Entities are IDs; components are pure data (no methods,
   no `reinitialize()`); systems are stateless and never call each other's
   `processTick`. Registration order is execution order.
5. **Pooling is engine-driven.** Game code calls only `pools.spawn()` /
   `pools.despawn()`. Components attach once in the constructor. `onSpawn` /
   `onDespawn` must not allocate.
6. **No allocations in tick hot loops.** Cache SoA stores in `init()`, hoist
   typed arrays out of loops, iterate `store.entityIds()`.
7. **Networking is command-based.** Send intent, never state. The server owns
   the tick clock. Iterate command batches in sorted `playerId` order. Call
   `sendReady()` only after full initialisation.
8. **TypeScript.** `strict`, `noUncheckedIndexedAccess`, **no `any`**, prefer
   `interface` for public API. ESM relative imports carry the `.js` extension.
9. **Style.** Prettier (single quotes, semicolons, 80 cols, 2 spaces). Only
   `console.warn`/`console.error`, and not as informational logging.
10. **Tests.** Vitest, `tests/**/*.test.ts`. `resetEntityIdCounter()` in
    `beforeEach`, `SoAComponent.resetContext()` in `afterEach`. Compare FP with
    `FP.Eq/Lt/Gt`, not `toBeCloseTo`.

## Before finishing

`pnpm build && pnpm test && pnpm lint && pnpm format:check` must all pass.
