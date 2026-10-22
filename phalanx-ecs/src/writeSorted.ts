import type { StateWriter } from './state/StateIO.js';

/**
 * Write a `Set` or `Map` in ascending key order.
 *
 * String keys compare by UTF-16 code units (`<`), the same order as save
 * section keys. Number keys compare numerically and must be safe integers.
 * One collection cannot mix strings and numbers. `Map` iteration order is
 * not part of the bytes: the callback writes each key, and any value it
 * reads back from the map, after the keys have been sorted.
 */
export function writeSorted<K extends string | number>(
  writer: StateWriter,
  values: ReadonlySet<K> | ReadonlyMap<K, unknown>,
  write: (key: K, writer: StateWriter) => void
): void {
  const keys: K[] = [];
  let kind: 'string' | 'number' | null = null;
  for (const key of values.keys()) {
    kind = assertKey(key, kind);
    keys.push(key);
  }
  keys.sort(compareKeys);
  writer.list(keys, (key, item) => {
    write(key, item);
  });
}

function assertKey(
  key: unknown,
  kind: 'string' | 'number' | null
): 'string' | 'number' {
  if (typeof key === 'string') {
    if (kind === 'number') {
      throw new Error('writeSorted: mixed string and number keys');
    }
    return 'string';
  }
  if (typeof key === 'number' && Number.isSafeInteger(key)) {
    if (kind === 'string') {
      throw new Error('writeSorted: mixed string and number keys');
    }
    return 'number';
  }
  throw new Error('writeSorted: key must be a string or a safe integer');
}

function compareKeys(left: string | number, right: string | number): number {
  if (typeof left !== typeof right) {
    throw new Error('writeSorted: mixed string and number keys');
  }
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
