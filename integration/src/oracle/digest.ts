import { createHash } from 'node:crypto';
import type { StateDump } from '../driver/SimDriver.js';

/**
 * Hash of the live canonical dump (entities, GAS, RNG, bots).
 * This is not `MatchRunner.digest()`, which hashes snapshot save-bytes.
 */
export function canonicalDigest(dump: StateDump): string {
  // Contact totals are harness counters. They are not in the snapshot,
  // so a restore must not look like a different world because of them.
  return createHash('sha256')
    .update(stable({ ...dump, contacts: '' }))
    .digest('hex');
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stable(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`;
}
