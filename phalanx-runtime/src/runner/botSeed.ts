/**
 * Unsigned 32-bit mix of the match seed and the slot. Addition would
 * collide (`seed 5, slot 1` vs `seed 6, slot 0`); this does not.
 *
 * Starting bots and a `setController` handover to bot both use this mix.
 */
export function botSlotSeed(seed: number, slot: number): number {
  let mixed = (seed >>> 0) ^ Math.imul(slot + 1, 0x9e3779b1);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
