# Plan: ECS Query Performance Optimization

Optimize the ECS query system to reduce per-frame allocations and redundant computations while maintaining deterministic ordering for lockstep networking. The approach focuses on query caching, reducing allocations in hot paths, and consolidating redundant queries.

## Steps

### 1. Add archetype-based query caching in [`EntityManager`](src/core/EntityManager.ts)

- Introduce a `QueryCache` that stores pre-computed, sorted entity lists keyed by component signature (e.g., `"Attack,Health,Team"`)
- Invalidate cache entries only when entities are added/removed or components change via `onComponentAdded`/`onComponentRemoved`
- Return cached arrays directly instead of creating new ones each call

### 2. Add dirty flag tracking for cache invalidation in [`EntityManager`](src/core/EntityManager.ts)

- Track a `cacheVersion` number that increments on any entity/component change
- Each cached query stores its `version`; if stale, rebuild just that query
- This avoids full cache clears while keeping deterministic ordering

### 3. Consolidate redundant `queryEntities()` calls in [`PhysicsSystem`](src/systems/PhysicsSystem.ts)

- Currently queries `ComponentType.PhysicsBody` 5 times per tick
- Cache the query result at the start of `processTick()` in a local variable and reuse throughout the method

### 4. Pre-allocate reusable iteration buffers in [`EntityManager.queryEntities()`](src/core/EntityManager.ts)

- For queries without caching, avoid `result.push()` growth by pre-sizing arrays based on `firstSet.size`
- Replace `.sort()` with insertion into a pre-sorted structure or use stable sort with cached comparison

### 5. Optimize `Entity.hasComponents()` in [`Entity.ts`](src/entities/Entity.ts)

- Replace `types.every()` with a simple for-loop to avoid closure allocation
- Consider using a bitmask for component presence checks (optional, larger refactor)

## Further Considerations

1. **Bitmask component queries?** More invasive refactor but offers O(1) component checks. Recommend deferring unless profiling shows `hasComponents()` is a bottleneck.

2. **Object pooling for entities?** Important if entities are frequently created/destroyed (projectiles). Should this be included in scope? *Recommend: Yes, add as Phase 2*

3. **Frame vs Tick cache separation?** Frame systems can tolerate slightly stale caches; tick systems need exact consistency. Should caches be separate? *Recommend: Single cache with version tracking is sufficient*

