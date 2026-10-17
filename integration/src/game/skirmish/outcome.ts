export function tickLimitOutcome(
  tick: number,
  tickLimit: number
): { readonly kind: 'draw'; readonly reason: string } | null {
  if (tick + 1 >= tickLimit) return { kind: 'draw', reason: 'tick limit' };
  return null;
}
