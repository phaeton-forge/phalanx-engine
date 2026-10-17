import { KIND_ARCHER, KIND_SOLDIER, KIND_TOTEM } from './types.js';

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

export interface SpawnPlan {
  readonly kind: number;
  readonly slot: number;
  readonly team: number;
  readonly x: bigint;
  readonly z: bigint;
}

/** Opening roster. Army mode fills soldiers; otherwise one soldier per slot plus an archer and a totem. */
export function rosterPlans(
  armySize: number,
  slots: readonly { readonly slot: number; readonly team: number }[]
): SpawnPlan[] {
  if (armySize > 0) {
    const plans: SpawnPlan[] = [];
    for (let index = 0; index < armySize; index += 1) {
      const placed = armySpawn(index);
      plans.push({
        kind: KIND_SOLDIER,
        slot: placed.slot,
        team: placed.team,
        x: placed.x,
        z: placed.z,
      });
    }
    return plans;
  }
  const plans: SpawnPlan[] = [];
  for (const slot of slots) {
    const placed = slotSpawn(slot.slot, KIND_SOLDIER);
    plans.push({
      kind: KIND_SOLDIER,
      slot: slot.slot,
      team: slot.team,
      x: placed.x,
      z: placed.z,
    });
  }
  const first = slots[0];
  if (first !== undefined) {
    const archer = slotSpawn(first.slot, KIND_ARCHER);
    const totem = slotSpawn(first.slot, KIND_TOTEM);
    plans.push({
      kind: KIND_ARCHER,
      slot: first.slot,
      team: first.team,
      x: archer.x,
      z: archer.z,
    });
    plans.push({
      kind: KIND_TOTEM,
      slot: first.slot,
      team: first.team,
      x: totem.x,
      z: totem.z,
    });
  }
  return plans;
}
