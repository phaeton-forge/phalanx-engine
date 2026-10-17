import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../../src/game/commands.js';
import {
  canonicalJsonValue,
  decodeInputCheckpoint,
  encodeInputCheckpoint,
  type InputCheckpoint,
} from '../../src/runner/InputCheckpoint.js';
import type { LogEntry } from '../../src/runner/CommandLog.js';
import { SnapshotRejectedError } from '../../src/state/errors.js';
import { canonicalConfigBytes } from '../../src/state/snapshot.js';

function entry(payload: JsonValue): LogEntry {
  return {
    tick: 3,
    playerId: 'local:0',
    type: 'move',
    data: { q: 1, p: payload },
  };
}

function roundTrip(payload: JsonValue): JsonValue {
  const checkpoint: InputCheckpoint = {
    pending: [{ tick: 3, entries: [entry(payload)] }],
    nextSeq: [{ slot: 0, nextSeq: 2 }],
    systemSeq: 4,
  };
  const decoded = decodeInputCheckpoint(encodeInputCheckpoint(checkpoint));
  expect(decoded.systemSeq).toBe(4);
  return decoded.pending[0]?.entries[0]?.data.p ?? null;
}

describe('input checkpoint payload codec', () => {
  it('round-trips finite numbers that canonicalConfigBytes rejects', () => {
    const samples = [0, -0, 0.5, 0.1, -1.25, 1e21, Number.MIN_VALUE];
    for (const sample of samples) {
      expect(Object.is(canonicalJsonValue(sample), sample)).toBe(true);
      expect(Object.is(roundTrip(sample), sample)).toBe(true);
      if (!Number.isSafeInteger(sample)) {
        expect(() => canonicalConfigBytes(sample)).toThrow(/safe integer/);
      }
    }
    const mixed = canonicalJsonValue({
      type: 'move',
      speed: 0.5,
      dx: '1',
    });
    expect(Object.keys(mixed as object)).toEqual(['dx', 'speed', 'type']);
    expect(roundTrip({ speed: 0.5, nested: [1.5, { z: -0 }] })).toEqual({
      nested: [1.5, { z: -0 }],
      speed: 0.5,
    });
  });

  it('defines __proto__ and constructor as own data properties', () => {
    const payload: { [key: string]: JsonValue } = { ok: true };
    Object.defineProperty(payload, '__proto__', {
      value: { admin: true },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(payload, 'constructor', {
      value: { forged: 1 },
      writable: true,
      enumerable: true,
      configurable: true,
    });
    const decoded = roundTrip(payload);
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype);
    expect(Object.hasOwn(decoded as object, '__proto__')).toBe(true);
    expect(Object.hasOwn(decoded as object, 'constructor')).toBe(true);
    const record = decoded as { [key: string]: JsonValue };
    expect(record['__proto__']).toEqual({ admin: true });
    expect(record['constructor']).toEqual({ forged: 1 });
    expect(Object.hasOwn(Object.prototype, 'admin')).toBe(false);
  });

  it('rejects a format-2 checkpoint that has no systemSeq', () => {
    const checkpoint: InputCheckpoint = {
      pending: [{ tick: 3, entries: [entry({ type: 'move', dir: 1 })] }],
      nextSeq: [{ slot: 0, nextSeq: 2 }],
      systemSeq: 4,
    };
    const bytes = encodeInputCheckpoint(checkpoint);
    const truncated = bytes.subarray(0, bytes.length - 1);
    expect(() => decodeInputCheckpoint(truncated)).toThrow(
      SnapshotRejectedError
    );
    expect(() => decodeInputCheckpoint(truncated)).toThrow(/systemSeq/);
    expect(decodeInputCheckpoint(bytes).systemSeq).toBe(4);
    const extra = new Uint8Array(bytes.length + 1);
    extra.set(bytes);
    extra[bytes.length] = 0;
    expect(() => decodeInputCheckpoint(extra)).toThrow(/StateReader\.done:/);
  });
});
