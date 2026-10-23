import type { StateReader, StateWriter } from '@phalanx-engine/ecs';
import { FixedPoint } from '@phalanx-engine/math';

export const ABSENT = 0;
export const PRESENT = 1;

const VALUE_INT = 1;
const VALUE_BIGINT = 2;
const VALUE_STRING = 3;
const VALUE_BOOL = 4;
const VALUE_FP = 5;

export interface FixedPointShape {
  readonly base: bigint;
  readonly precision: bigint;
}

export function compareUtf16(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function asFixedPoint(value: unknown): FixedPointShape | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const base = record['base'];
  const precision = record['precision'];
  if (typeof base !== 'bigint' || typeof precision !== 'bigint') {
    return undefined;
  }
  return { base, precision };
}

/**
 * Raw base and the value's own precision, both `i64`.
 *
 * Same encoding as `writeBroadphase`. `FP.FromRaw` would default a missing
 * precision to 5 and is not used here.
 */
export function writeFixedPoint(w: StateWriter, fp: FixedPointShape): void {
  if (fp.precision < 0n) {
    throw new Error(
      'writeAbilities: fixed-point precision is not a non-negative integer'
    );
  }
  w.i64(fp.base);
  w.i64(fp.precision);
}

export function readFixedPoint(r: StateReader): FixedPoint {
  const base = r.i64();
  const precision = r.i64();
  if (precision < 0n) {
    throw new Error(
      'readAbilities: fixed-point precision is not a non-negative integer'
    );
  }
  return new FixedPoint(base, precision);
}

export function requireFixedPoint(
  value: unknown,
  label: string
): FixedPointShape {
  const fp = asFixedPoint(value);
  if (fp === undefined) {
    throw new Error(`writeAbilities: ${label} must be a FixedPoint`);
  }
  return fp;
}

function writeSetByCallerValue(
  w: StateWriter,
  key: string,
  value: unknown
): void {
  if (typeof value === 'string') {
    w.u8(VALUE_STRING);
    w.str(value);
    return;
  }
  if (typeof value === 'boolean') {
    w.u8(VALUE_BOOL);
    w.bool(value);
    return;
  }
  if (typeof value === 'bigint') {
    w.u8(VALUE_BIGINT);
    w.i64(value);
    return;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    w.u8(VALUE_INT);
    w.i64(BigInt(value));
    return;
  }
  const fp = asFixedPoint(value);
  if (fp !== undefined) {
    w.u8(VALUE_FP);
    writeFixedPoint(w, fp);
    return;
  }
  const typeName = value === null ? 'null' : typeof value;
  throw new Error(
    `writeAbilities: unsupported setByCaller value for '${key}' (${typeName})`
  );
}

function readSetByCallerValue(r: StateReader, key: string): unknown {
  const kind = r.u8();
  switch (kind) {
    case VALUE_INT: {
      const raw = r.i64();
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || BigInt(value) !== raw) {
        throw new Error(
          `readAbilities: setByCaller '${key}' integer does not fit a safe integer`
        );
      }
      return value;
    }
    case VALUE_BIGINT:
      return r.i64();
    case VALUE_STRING:
      return r.str();
    case VALUE_BOOL:
      return r.bool();
    case VALUE_FP:
      return readFixedPoint(r);
    default:
      throw new Error(
        `readAbilities: unknown setByCaller value kind ${String(kind)} for '${key}'`
      );
  }
}

/** Keys sorted by UTF-16 code unit. Null and undefined share one absent tag. */
export function writeSetByCaller(
  w: StateWriter,
  payload: ReadonlyMap<string, unknown> | null | undefined
): void {
  if (payload === undefined || payload === null) {
    w.u8(ABSENT);
    return;
  }
  w.u8(PRESENT);
  const keys = Array.from(payload.keys()).sort(compareUtf16);
  w.list(keys, (key, item) => {
    item.str(key);
    writeSetByCallerValue(item, key, payload.get(key));
  });
}

export function readSetByCaller(r: StateReader): Map<string, unknown> | null {
  const tag = r.u8();
  if (tag === ABSENT) return null;
  if (tag !== PRESENT) {
    throw new Error(`readAbilities: unknown setByCaller tag ${String(tag)}`);
  }
  const entries = r.list((item) => {
    const key = item.str();
    return { key, value: readSetByCallerValue(item, key) };
  });
  const map = new Map<string, unknown>();
  for (const entry of entries) map.set(entry.key, entry.value);
  return map;
}
