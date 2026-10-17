/** Three despawn/respawn cycles, three ticks each: capture, mutate, check. */
export const POOL_CYCLES = 3;

export type PoolPhase = 'capture' | 'mutate' | 'check' | 'done';

export function poolPhase(tick: number): PoolPhase {
  if (tick >= POOL_CYCLES * 3) return 'done';
  const phase = tick % 3;
  if (phase === 0) return 'capture';
  if (phase === 1) return 'mutate';
  return 'check';
}
