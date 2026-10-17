/** Home, range and velocity step used by the life tick. No engine types. */
export function driftedHome(
  home: bigint,
  roll: number,
  axis: 'x' | 'z'
): bigint {
  if (axis === 'x') return home + 1n;
  return home + BigInt(roll + 1);
}

export function driftedRange(range: bigint, roll: number): bigint {
  return range + BigInt(roll + 1);
}

export function driftVelocity(tick: number): bigint {
  return BigInt((tick % 5) + 1) * 20000n;
}

export function focusedHealth(current: bigint): bigint {
  return current + 1n;
}
