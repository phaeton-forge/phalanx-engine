import { describe, it, expect } from 'vitest';
import { FP } from 'phalanx-math';
import { SpatialHashGrid } from '../src/collision/SpatialHashGrid';

describe('SpatialHashGrid', () => {
  const cellSize = FP.FromFloat(4);

  it('returns no pairs for empty grid', () => {
    const grid = new SpatialHashGrid(cellSize);
    expect(grid.queryPairs()).toEqual([]);
  });

  it('returns a pair for two entities in the same cell', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(0.5);
    grid.insert(1, FP.FromFloat(1), FP.FromFloat(1), radius);
    grid.insert(2, FP.FromFloat(1.5), FP.FromFloat(1.5), radius);

    const pairs = grid.queryPairs();
    expect(pairs).toEqual([[1, 2]]);
  });

  it('deduplicates pairs across shared cells', () => {
    const grid = new SpatialHashGrid(cellSize);
    // Both entities have large radius, overlapping multiple cells
    const radius = FP.FromFloat(3);
    grid.insert(1, FP.FromFloat(0), FP.FromFloat(0), radius);
    grid.insert(2, FP.FromFloat(1), FP.FromFloat(1), radius);

    const pairs = grid.queryPairs();
    // Should only appear once
    expect(pairs).toEqual([[1, 2]]);
  });

  it('pairs are sorted (A < B) for determinism', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(0.5);
    // Insert in reverse order
    grid.insert(5, FP.FromFloat(1), FP.FromFloat(1), radius);
    grid.insert(3, FP.FromFloat(1.5), FP.FromFloat(1.5), radius);
    grid.insert(1, FP.FromFloat(2), FP.FromFloat(2), radius);

    const pairs = grid.queryPairs();
    for (const [a, b] of pairs) {
      expect(a).toBeLessThan(b);
    }
    // Check sorted order by first element
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i][0]).toBeGreaterThanOrEqual(pairs[i - 1][0]);
    }
  });

  it('remove() removes entity from the grid', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(0.5);
    grid.insert(1, FP.FromFloat(1), FP.FromFloat(1), radius);
    grid.insert(2, FP.FromFloat(1.5), FP.FromFloat(1.5), radius);

    grid.remove(1);
    expect(grid.queryPairs()).toEqual([]);
  });

  it('update() moves entity to new cell', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(0.5);
    grid.insert(1, FP.FromFloat(0), FP.FromFloat(0), radius);
    grid.insert(2, FP.FromFloat(0.5), FP.FromFloat(0.5), radius);

    // Move entity 1 far away
    grid.update(1, FP.FromFloat(100), FP.FromFloat(100), radius);
    expect(grid.queryPairs()).toEqual([]);
  });

  it('queryRadius returns entities within range', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(0.5);
    grid.insert(1, FP.FromFloat(0), FP.FromFloat(0), radius);
    grid.insert(2, FP.FromFloat(1), FP.FromFloat(0), radius);
    grid.insert(3, FP.FromFloat(100), FP.FromFloat(100), radius);

    const result = grid.queryRadius(FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(2));
    // Entity 1 and 2 are in nearby cells, entity 3 is far away
    expect(result).toContain(1);
    expect(result).toContain(2);
    expect(result).not.toContain(3);
  });

  it('queryRadius excludes entities in candidate cells but outside the exact radius', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(0.5);
    // Entity 1 is inside the query radius; entity 2 lands in the broad-phase
    // cell region but its center is outside the exact radius → filtered out.
    grid.insert(1, FP.FromFloat(1), FP.FromFloat(0), radius);
    grid.insert(2, FP.FromFloat(3.5), FP.FromFloat(0), radius);

    const result = grid.queryRadius(FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(2));
    expect(result).toContain(1);
    expect(result).not.toContain(2);
  });

  it('queryRadius reflects updated positions', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(0.5);
    grid.insert(1, FP.FromFloat(0), FP.FromFloat(0), radius);
    expect(grid.queryRadius(FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(2))).toContain(1);

    // Move entity 1 out of range — exact filter must drop it.
    grid.update(1, FP.FromFloat(50), FP.FromFloat(50), radius);
    expect(grid.queryRadius(FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(2))).not.toContain(1);
  });

  it('queryRadius results are sorted by entity ID', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(0.5);
    grid.insert(5, FP.FromFloat(0), FP.FromFloat(0), radius);
    grid.insert(2, FP.FromFloat(1), FP.FromFloat(0), radius);
    grid.insert(8, FP.FromFloat(0.5), FP.FromFloat(0.5), radius);

    const result = grid.queryRadius(FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(5));
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeGreaterThan(result[i - 1]);
    }
  });

  it('clear removes all entities', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(0.5);
    grid.insert(1, FP.FromFloat(0), FP.FromFloat(0), radius);
    grid.insert(2, FP.FromFloat(0.5), FP.FromFloat(0.5), radius);

    grid.clear();
    expect(grid.queryPairs()).toEqual([]);
    expect(grid.queryRadius(FP.FromFloat(0), FP.FromFloat(0), FP.FromFloat(100))).toEqual([]);
  });

  it('determinism: same operations produce same output', () => {
    const run = () => {
      const grid = new SpatialHashGrid(cellSize);
      const r = FP.FromFloat(1);
      grid.insert(3, FP.FromFloat(2), FP.FromFloat(2), r);
      grid.insert(1, FP.FromFloat(0), FP.FromFloat(0), r);
      grid.insert(2, FP.FromFloat(1), FP.FromFloat(1), r);
      return grid.queryPairs().map(p => `${p[0]},${p[1]}`);
    };

    const result1 = run();
    const result2 = run();
    expect(result1).toEqual(result2);
  });

  it('handles two entities at exact same position', () => {
    const grid = new SpatialHashGrid(cellSize);
    const radius = FP.FromFloat(1);
    grid.insert(1, FP.FromFloat(5), FP.FromFloat(5), radius);
    grid.insert(2, FP.FromFloat(5), FP.FromFloat(5), radius);

    const pairs = grid.queryPairs();
    expect(pairs).toEqual([[1, 2]]);
  });
});
