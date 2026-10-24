import { describe, expect, it } from 'vitest';
import { BinaryStateReader } from '@phalanx-engine/ecs';
import { SnapshotRejectedError } from '../../src/state/errors.js';
import {
  canonicalConfigBytes,
  checkSnapshotCompatibility,
  configHash,
  decodeSnapshot,
  digestBytes,
  encodeSnapshot,
  type ExpectedSnapshotIdentity,
  type SnapshotHeader,
} from '../../src/state/snapshot.js';

/**
 * XXH64(seed 0) from the reference implementation in xxHash 0.8.2.
 * Empty and "abc" are the required vectors; the others lock the stripe
 * path (32 bytes), the short path (31) and a one-byte tail (33, and the
 * 8-byte lane).
 */
const XXH64_VECTORS: readonly {
  label: string;
  bytes: Uint8Array;
  hex: string;
}[] = [
  { label: 'empty', bytes: new Uint8Array(), hex: 'ef46db3751d8e999' },
  {
    label: 'abc',
    bytes: new TextEncoder().encode('abc'),
    hex: '44bc2cf5ad770999',
  },
  {
    label: '31',
    bytes: new TextEncoder().encode('0123456789abcdef0123456789abcde'),
    hex: '1fdfc63febacfde7',
  },
  {
    label: '32',
    bytes: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
    hex: '642a94958e71e6c5',
  },
  {
    label: '33',
    bytes: new TextEncoder().encode('0123456789abcdef0123456789abcdef!'),
    hex: '8afff4daac4e677e',
  },
  {
    label: 'bytes8',
    bytes: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
    hex: '884a173614b81b8d',
  },
];

const expected: ExpectedSnapshotIdentity = {
  engineFormat: 1,
  gameId: 'sketch-legion',
  simVersion: 'legion-1',
  formatVersion: 3,
  configHash: 'ab'.repeat(8),
};

function header(over: Partial<SnapshotHeader> = {}): SnapshotHeader {
  return {
    magic: 'PHXS',
    engineFormat: 1,
    gameId: 'sketch-legion',
    simVersion: 'legion-1',
    formatVersion: 3,
    configHash: 'ab'.repeat(8),
    tick: 10,
    digest: 'cd'.repeat(8),
    ...over,
  };
}

function fields(over: Partial<Omit<SnapshotHeader, 'magic' | 'digest'>> = {}) {
  return {
    engineFormat: 1,
    gameId: 'g',
    simVersion: 'sim-1',
    formatVersion: 128,
    configHash: 'ab'.repeat(8),
    tick: 300,
    ...over,
  };
}

describe('digestBytes', () => {
  it.each(XXH64_VECTORS)(
    'matches xxHash 0.8.2 for $label',
    ({ bytes, hex }) => {
      expect(digestBytes(bytes)).toBe(hex);
      expect(digestBytes(bytes)).toHaveLength(16);
      expect(digestBytes(bytes)).toBe(hex.toLowerCase());
    }
  );

  it('hashes a subarray, not the underlying buffer', () => {
    const buf = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const view = buf.subarray(0, 8);
    expect(digestBytes(view)).toBe('884a173614b81b8d');
    expect(digestBytes(view)).not.toBe(digestBytes(buf));
  });
});

describe('snapshot header', () => {
  const body = new Uint8Array([9, 8, 7]);

  it('round-trips the header, body, bot state and input checkpoint', () => {
    const botState = new Uint8Array([1]);
    const inputCheckpoint = new Uint8Array([2, 3]);
    const encoded = encodeSnapshot(fields(), body, {
      botState,
      inputCheckpoint,
    });
    const decoded = decodeSnapshot(encoded);
    expect(decoded.header).toEqual({
      magic: 'PHXS',
      ...fields(),
      digest: digestBytes(body),
    });
    expect(decoded.body).toEqual(body);
    expect(decoded.botState).toEqual(botState);
    expect(decoded.inputCheckpoint).toEqual(inputCheckpoint);
    expect(
      encodeSnapshot(fields(), body, { botState, inputCheckpoint })
    ).toEqual(encoded);
  });

  it('uses varints for engineFormat, formatVersion and tick', () => {
    const encoded = encodeSnapshot(fields(), body, {
      botState: new Uint8Array([1]),
      inputCheckpoint: new Uint8Array([2, 3]),
    });
    const r = new BinaryStateReader(encoded);
    expect([r.u8(), r.u8(), r.u8(), r.u8()]).toEqual([0x50, 0x48, 0x58, 0x53]);
    expect(r.varint()).toBe(1);
    expect(r.str()).toBe('g');
    expect(r.str()).toBe('sim-1');
    expect(r.varint()).toBe(128);
    expect(r.str()).toBe('ab'.repeat(8));
    expect(r.varint()).toBe(300);
    expect(r.str()).toBe(digestBytes(body));
    expect(r.bytes()).toEqual(body);
    expect(r.bool()).toBe(true);
    expect(r.bytes()).toEqual(new Uint8Array([1]));
    expect(r.bool()).toBe(true);
    expect(r.bytes()).toEqual(new Uint8Array([2, 3]));
    expect(r.bool()).toBe(false);
    r.done();
  });

  it('keeps bot state and the input checkpoint outside the digest', () => {
    const plain = decodeSnapshot(encodeSnapshot(fields(), body));
    const withExtras = decodeSnapshot(
      encodeSnapshot(fields(), body, {
        botState: new Uint8Array([9, 9, 9]),
        inputCheckpoint: new Uint8Array([7]),
      })
    );
    const botOnly = decodeSnapshot(
      encodeSnapshot(fields(), body, { botState: new Uint8Array([4]) })
    );
    const inputOnly = decodeSnapshot(
      encodeSnapshot(fields(), body, {
        inputCheckpoint: new Uint8Array([5]),
      })
    );
    expect(plain.header.digest).toBe(digestBytes(body));
    expect(withExtras.header.digest).toBe(plain.header.digest);
    expect(botOnly.header.digest).toBe(plain.header.digest);
    expect(inputOnly.header.digest).toBe(plain.header.digest);
    expect(plain.botState).toBeNull();
    expect(plain.inputCheckpoint).toBeNull();
    expect(plain.componentSchemas).toBeNull();
    expect(withExtras.botState).toEqual(new Uint8Array([9, 9, 9]));
    expect(withExtras.inputCheckpoint).toEqual(new Uint8Array([7]));
    expect(botOnly.inputCheckpoint).toBeNull();
    expect(inputOnly.botState).toBeNull();
    expect(encodeSnapshot(fields(), body)).not.toEqual(
      encodeSnapshot(fields(), body, { botState: new Uint8Array([9]) })
    );
  });

  it('treats null and omission as absent, and empty bytes as present', () => {
    const omitted = encodeSnapshot(fields(), body);
    expect(omitted).toEqual(encodeSnapshot(fields(), body, {}));
    expect(omitted).toEqual(
      encodeSnapshot(fields(), body, {
        botState: null,
        inputCheckpoint: null,
      })
    );
    const emptyBot = encodeSnapshot(fields(), body, {
      botState: new Uint8Array(),
    });
    expect(emptyBot).not.toEqual(omitted);
    const decoded = decodeSnapshot(emptyBot);
    expect(decoded.botState).toEqual(new Uint8Array());
    expect(decoded.inputCheckpoint).toBeNull();
  });

  it('hashes an empty body as the empty xxhash vector', () => {
    const empty = new Uint8Array();
    expect(decodeSnapshot(encodeSnapshot(fields(), empty)).header.digest).toBe(
      'ef46db3751d8e999'
    );
  });

  it('rejects a bad magic, a truncated buffer, trailing bytes and a bad digest', () => {
    const encoded = encodeSnapshot(fields(), new Uint8Array([1, 2, 3, 4]));
    const badMagic = encoded.slice();
    badMagic[0] = 0;
    expect(() => decodeSnapshot(badMagic)).toThrow(SnapshotRejectedError);
    expect(() => decodeSnapshot(badMagic)).toThrow(/magic mismatch/);
    expect(() => decodeSnapshot(new Uint8Array([0x50, 0x48]))).toThrow(
      /truncated snapshot/
    );

    const tampered = tamperBody(encoded, new Uint8Array([1, 2, 3, 4]));
    expect(() => decodeSnapshot(tampered)).toThrow(SnapshotRejectedError);
    expect(() => decodeSnapshot(tampered)).toThrow(/digest mismatch/);

    const padded = new Uint8Array(encoded.length + 1);
    padded.set(encoded);
    padded[encoded.length] = 1;
    const trailing = captureRejected(padded);
    expect(trailing).toBeInstanceOf(SnapshotRejectedError);
    expect(trailing.message).toMatch(/unread byte/);
    expect(trailing.cause).toBeInstanceOf(Error);
    expect((trailing.cause as Error).message).toMatch(/unread byte/);

    const truncated = captureRejected(encoded.subarray(0, 6));
    expect(truncated).toBeInstanceOf(SnapshotRejectedError);
    expect(truncated.message).toMatch(/unexpected end of buffer/);
    expect(truncated.cause).toBeInstanceOf(Error);
    expect((truncated.cause as Error).message).toMatch(
      /unexpected end of buffer/
    );
    expect(() => decodeSnapshot(new Uint8Array([0x50, 0x48]))).toThrow(
      SnapshotRejectedError
    );
  });
});

describe('version policy matrix', () => {
  const migrations = { 1: true, 2: true };

  it('rejects magic or engineFormat mismatches', () => {
    expect(
      checkSnapshotCompatibility(header({ magic: 'NOPE' as 'PHXS' }), expected)
    ).toEqual({ decision: 'reject', reason: 'magic mismatch' });
    expect(
      checkSnapshotCompatibility(header({ engineFormat: 2 }), expected)
    ).toEqual({
      decision: 'reject',
      reason: 'unsupported engine snapshot format 2; expected 1',
    });
  });

  it('rejects engine snapshot format 1 with a version error', () => {
    expect(
      checkSnapshotCompatibility(header({ engineFormat: 1 }), {
        ...expected,
        engineFormat: 2,
      })
    ).toEqual({
      decision: 'reject',
      reason: 'unsupported engine snapshot format 1; expected 2',
    });
  });

  it('rejects gameId or configHash mismatches', () => {
    expect(
      checkSnapshotCompatibility(header({ gameId: 'other' }), expected)
    ).toEqual({ decision: 'reject', reason: 'gameId mismatch' });
    expect(
      checkSnapshotCompatibility(
        header({ configHash: 'ff'.repeat(8) }),
        expected
      )
    ).toEqual({ decision: 'reject', reason: 'configHash mismatch' });
  });

  it('rejects a simVersion mismatch even when the format is older', () => {
    expect(
      checkSnapshotCompatibility(header({ simVersion: 'legion-0' }), expected)
    ).toEqual({ decision: 'reject', reason: 'simVersion mismatch' });
    expect(
      checkSnapshotCompatibility(
        header({ simVersion: 'legion-0', formatVersion: 1 }),
        expected,
        migrations
      )
    ).toEqual({ decision: 'reject', reason: 'simVersion mismatch' });
  });

  it('migrates an older format only when every step exists', () => {
    expect(
      checkSnapshotCompatibility(
        header({ formatVersion: 1 }),
        expected,
        migrations
      )
    ).toEqual({ decision: 'migrate' });
    expect(
      checkSnapshotCompatibility(header({ formatVersion: 1 }), expected, {
        1: true,
      })
    ).toEqual({
      decision: 'reject',
      reason: 'missing migration from format 2',
    });
    expect(
      checkSnapshotCompatibility(header({ formatVersion: 1 }), expected)
    ).toEqual({
      decision: 'reject',
      reason: 'missing migration from format 1',
    });
  });

  it('rejects a newer formatVersion', () => {
    expect(
      checkSnapshotCompatibility(header({ formatVersion: 4 }), expected, {
        3: true,
      })
    ).toEqual({ decision: 'reject', reason: 'formatVersion is newer' });
  });

  it('rejects a digest that does not match the body', () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const encoded = encodeSnapshot(
      {
        engineFormat: expected.engineFormat,
        gameId: expected.gameId,
        simVersion: expected.simVersion,
        formatVersion: expected.formatVersion,
        configHash: expected.configHash,
        tick: 10,
      },
      body
    );
    const tampered = tamperBody(encoded, body);
    expect(() => decodeSnapshot(tampered)).toThrow(SnapshotRejectedError);
    expect(() => decodeSnapshot(tampered)).toThrow(/digest mismatch/);
    // The compatibility function does not see the body. A stored digest
    // string, matching or not, does not change its decision.
    expect(
      checkSnapshotCompatibility(header({ digest: '00'.repeat(8) }), expected)
    ).toEqual({ decision: 'accept' });
  });

  it('accepts an exact identity match', () => {
    expect(checkSnapshotCompatibility(header(), expected)).toEqual({
      decision: 'accept',
    });
  });
});

describe('canonicalConfigBytes / configHash', () => {
  it('sorts object keys by UTF-16 code unit and keeps array order', () => {
    const left = canonicalConfigBytes({ a: 1, B: 2, c: { z: true, a: null } });
    const right = canonicalConfigBytes({ c: { a: null, z: true }, B: 2, a: 1 });
    expect(left).toEqual(right);

    const r = new BinaryStateReader(left);
    expect(r.u8()).toBe(5);
    expect(r.varint()).toBe(3);
    expect(r.str()).toBe('B');
    expect(r.u8()).toBe(2);
    expect(r.i64()).toBe(2n);
    expect(r.str()).toBe('a');
    expect(r.u8()).toBe(2);
    expect(r.i64()).toBe(1n);
    expect(r.str()).toBe('c');
    expect(r.u8()).toBe(5);
    expect(r.varint()).toBe(2);
    expect(r.str()).toBe('a');
    expect(r.u8()).toBe(0);
    expect(r.str()).toBe('z');
    expect(r.u8()).toBe(1);
    expect(r.bool()).toBe(true);
    r.done();

    expect(canonicalConfigBytes([1, 2])).not.toEqual(
      canonicalConfigBytes([2, 1])
    );
    const list = new BinaryStateReader(canonicalConfigBytes([1, 2]));
    expect(list.u8()).toBe(4);
    expect(list.varint()).toBe(2);
    expect(list.u8()).toBe(2);
    expect(list.i64()).toBe(1n);
    expect(list.u8()).toBe(2);
    expect(list.i64()).toBe(2n);
    list.done();
  });

  it('hashes the canonical bytes and ignores insertion order', () => {
    const config = { seed: 1, name: 'a', nested: { y: 2, x: 1 } };
    expect(configHash(config)).toBe(digestBytes(canonicalConfigBytes(config)));
    expect(configHash(config)).toMatch(/^[0-9a-f]{16}$/);
    expect(configHash(config)).toBe(
      configHash({ name: 'a', nested: { x: 1, y: 2 }, seed: 1 })
    );
    expect(configHash({ seed: 1 })).not.toBe(configHash({ seed: 2 }));
    const gravityFirst = {
      tick: ['GravitySystem', 'PhysicsSystem'],
      frame: ['InterpolationSystem'],
    };
    const physicsFirst = {
      tick: ['PhysicsSystem', 'GravitySystem'],
      frame: ['InterpolationSystem'],
    };
    expect(
      configHash({ seed: 1 }, undefined, undefined, gravityFirst)
    ).not.toBe(configHash({ seed: 1 }, undefined, undefined, physicsFirst));
    expect(
      configHash({ seed: 1 }, undefined, undefined, { tick: [], frame: [] })
    ).toBe(configHash({ seed: 1 }));
  });

  it('accepts safe integers, strings, bools, null and null-prototype objects', () => {
    expect(canonicalConfigBytes(Number.MAX_SAFE_INTEGER)).toBeInstanceOf(
      Uint8Array
    );
    expect(canonicalConfigBytes(-Number.MAX_SAFE_INTEGER)).toBeInstanceOf(
      Uint8Array
    );
    const plain = Object.create(null) as { z: number; a: number };
    plain.z = 1;
    plain.a = 2;
    expect(canonicalConfigBytes(plain)).toEqual(
      canonicalConfigBytes({ a: 2, z: 1 })
    );
    const shared = { n: 1 };
    expect(canonicalConfigBytes({ a: shared, b: shared })).toBeInstanceOf(
      Uint8Array
    );
    const text = new BinaryStateReader(canonicalConfigBytes('é'));
    expect(text.u8()).toBe(3);
    expect(text.str()).toBe('é');
    text.done();
  });

  it('rejects unpaired surrogates in config values and keys', () => {
    expect(() => canonicalConfigBytes('\uD800')).toThrow(/unpaired surrogate/);
    expect(() => canonicalConfigBytes({ '\uD800': 1 })).toThrow(
      /unpaired surrogate/
    );
    expect(() => canonicalConfigBytes({ label: '\uDC00' })).toThrow(
      /unpaired surrogate/
    );
    expect(() => canonicalConfigBytes(['a\uD800'])).toThrow(
      /unpaired surrogate/
    );

    const emoji = canonicalConfigBytes({ label: '😀' });
    const replacement = canonicalConfigBytes({ label: '\uFFFD' });
    expect(emoji).not.toEqual(replacement);
    const text = new BinaryStateReader(canonicalConfigBytes('😀'));
    expect(text.u8()).toBe(3);
    expect(text.str()).toBe('😀');
    text.done();
    const keyed = new BinaryStateReader(canonicalConfigBytes({ '😀': 1 }));
    expect(keyed.u8()).toBe(5);
    expect(keyed.varint()).toBe(1);
    expect(keyed.str()).toBe('😀');
    expect(keyed.u8()).toBe(2);
    expect(keyed.i64()).toBe(1n);
    keyed.done();
  });

  it('throws on floats, bigint, undefined, functions, symbols and class instances', () => {
    expect(() => canonicalConfigBytes(1.5)).toThrow(/safe integer/);
    expect(() => canonicalConfigBytes(Number.NaN)).toThrow(/safe integer/);
    expect(() => canonicalConfigBytes(Number.POSITIVE_INFINITY)).toThrow(
      /safe integer/
    );
    expect(() => canonicalConfigBytes(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /safe integer/
    );
    expect(() => canonicalConfigBytes(1n)).toThrow(/bigint/);
    expect(() => canonicalConfigBytes(undefined)).toThrow(/undefined/);
    expect(() => canonicalConfigBytes({ a: undefined })).toThrow(/undefined/);
    expect(() => canonicalConfigBytes(() => 1)).toThrow(/function/);
    expect(() => canonicalConfigBytes(Symbol('x'))).toThrow(/symbol/);
    expect(() => canonicalConfigBytes(new Date())).toThrow(/class instance/);
    class Box {
      public constructor(public n: number) {}
    }
    expect(() => canonicalConfigBytes(new Box(1))).toThrow(/class instance/);
    expect(() => canonicalConfigBytes(new Uint8Array([1]))).toThrow(
      /class instance/
    );
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => canonicalConfigBytes(circular)).toThrow(/circular/);
  });
});

function tamperBody(encoded: Uint8Array, body: Uint8Array): Uint8Array {
  const tampered = encoded.slice();
  const at = indexOfBytes(tampered, body);
  if (at < 0) throw new Error('expected the body in the snapshot');
  const byte = tampered[at];
  if (byte === undefined) throw new Error('expected a body byte');
  tampered[at] = byte ^ 0xff;
  return tampered;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    let found = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        found = false;
        break;
      }
    }
    if (found) return start;
  }
  return -1;
}

function captureRejected(bytes: Uint8Array): SnapshotRejectedError {
  try {
    decodeSnapshot(bytes);
  } catch (error) {
    if (error instanceof SnapshotRejectedError) return error;
    throw error;
  }
  throw new Error('expected SnapshotRejectedError');
}
