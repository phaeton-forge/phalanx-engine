import type { BotMemory, BotView, UnitView } from '../../facade/GameFacade.js';
import type { SkirmishCommand } from './types.js';

/**
 * Aggressive: close on the remembered target (or the lowest enemy id)
 * and strike. Defensive: hold the spawn and strike only when an enemy
 * is already near. Both keep a phase counter and a target id.
 */
export function decideAggressive(
  view: BotView,
  memory: BotMemory,
  roll: number
): readonly SkirmishCommand[] {
  const self = view.self;
  if (self === null) return [{ type: 'spawn', kind: 1 }];
  const target = remember(view.enemies, memory);
  if (target === null) return [];
  memory.phase += 1;
  if (roll === 0) return [{ type: 'cast', ability: 0, target: target.id }];
  return [{ type: 'move', dir: stepToward(self, target) }];
}

export function decideDefensive(
  view: BotView,
  memory: BotMemory,
  roll: number
): readonly SkirmishCommand[] {
  const self = view.self;
  if (self === null) return [{ type: 'spawn', kind: 1 }];
  memory.phase += 1;
  const nearest = lowest(view.enemies);
  if (nearest !== null && roll === 0) {
    memory.target = nearest.id;
    return [{ type: 'attack', target: nearest.id }];
  }
  if (memory.phase % 5 === 0)
    return [{ type: 'cast', ability: 1, target: self.id }];
  return [{ type: 'move', dir: memory.phase % 2 === 0 ? 0 : 2 }];
}

function remember(
  enemies: readonly UnitView[],
  memory: BotMemory
): UnitView | null {
  for (const enemy of enemies) {
    if (enemy.id === memory.target) return enemy;
  }
  const next = lowest(enemies);
  memory.target = next === null ? 0 : next.id;
  return next;
}

function lowest(units: readonly UnitView[]): UnitView | null {
  let best: UnitView | null = null;
  for (const unit of units) {
    if (best === null || unit.id < best.id) best = unit;
  }
  return best;
}

function stepToward(self: UnitView, target: UnitView): number {
  const dx = target.x - self.x;
  const dz = target.z - self.z;
  const adx = dx < 0n ? -dx : dx;
  const adz = dz < 0n ? -dz : dz;
  if (adx >= adz) return dx >= 0n ? 0 : 2;
  return dz >= 0n ? 1 : 3;
}
