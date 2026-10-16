import { KIND_ARCHER, KIND_TOTEM } from './types.js';

const ONE = 100000n;
/** Centers 1.5 apart so radius-1 bodies overlap and the narrowphase fires. */
const ARMY_GAP = 150000n;

export function slotSpawn(
  slot: number,
  kind: number
): { readonly x: bigint; readonly z: bigint } {
  if (kind === KIND_TOTEM) return { x: 0n, z: ONE * 3n };
  if (kind === KIND_ARCHER) return { x: ONE * 4n, z: ONE };
  return { x: ONE * BigInt(slot), z: 0n };
}

export function armySpawn(index: number): {
  readonly x: bigint;
  readonly z: bigint;
  readonly team: number;
  readonly slot: number;
} {
  const columns = 22;
  const column = index % columns;
  const row = Math.floor(index / columns);
  const team = index % 2;
  return {
    x: ARMY_GAP * BigInt(column),
    z: ARMY_GAP * BigInt(row),
    team,
    slot: team,
  };
}
