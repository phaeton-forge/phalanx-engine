import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { digestBytes, initDigest, onDigestFallback } from '../../src/index.js';
import { xxh64BigInt } from '../reference/xxh64BigInt.js';
import {
  forceXxh64FallbackForTests,
  resetXxh64ForTests,
  xxh64WasmByteLength,
} from '../../src/state/xxh64Wasm.js';

const PRIME32 = 0x9e3779b1n;
/**
 * Sanity-buffer multiplier from xxHash 0.8.2 `XSUM_fillTestBuffer`.
 * It is 11400714785074694797, not the XXH64 prime `0x9E3779B185EBCA87`.
 */
const PRIME64 = 0x9e3779b185ebca8dn;
const MASK64 = 0xffffffffffffffffn;

/** xxHash 0.8.2 sanity buffer: byte = byteGen >> 56, byteGen *= PRIME64. */
function sanity(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let byteGen = PRIME32;
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number((byteGen >> 56n) & 0xffn);
    byteGen = (byteGen * PRIME64) & MASK64;
  }
  return bytes;
}

const OFFICIAL: readonly (readonly [number, string])[] = [
  [0, 'ef46db3751d8e999'],
  [1, 'e934a84adb052768'],
  [4, '9136a0dca57457ee'],
  [8, 'cdbcf538e71d1348'],
  [31, '299b39a290e6d783'],
  [32, '18b216492bb44b70'],
  [33, '55c8dc3e578f5b59'],
  [64, 'ef558f8acac2b5cd'],
  [1000, '52bd1358f22e9ef7'],
];

function unaligned(bytes: Uint8Array, salt: number): Uint8Array {
  const pad = 1 + (salt % 7);
  const backing = new Uint8Array(pad + bytes.byteLength + 3);
  backing.set(bytes, pad);
  return new Uint8Array(
    backing.buffer,
    backing.byteOffset + pad,
    bytes.byteLength
  );
}

function nextUint(state: { value: number }): number {
  state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
  return state.value;
}

function randomBuffer(state: { value: number }): Uint8Array {
  const length = nextUint(state) % 400_001;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = nextUint(state) & 0xff;
  }
  return unaligned(bytes, nextUint(state));
}

describe('xxh64 wasm', () => {
  afterEach(async () => {
    resetXxh64ForTests();
    await initDigest();
  });

  it('keeps the embedded module small enough for a synchronous compile', () => {
    expect(xxh64WasmByteLength()).toBeLessThanOrEqual(4096);
    expect(xxh64WasmByteLength()).toBeGreaterThan(0);
  });

  it('matches the official seed-0 vectors after init', async () => {
    await initDigest();
    await initDigest();
    expect(digestBytes(new Uint8Array())).toBe('ef46db3751d8e999');
    expect(digestBytes(new TextEncoder().encode('abc'))).toBe(
      '44bc2cf5ad770999'
    );
    for (const [length, hex] of OFFICIAL) {
      expect(digestBytes(sanity(length))).toBe(hex);
    }
  });

  it('compiles on the first hash without a fallback event', async () => {
    resetXxh64ForTests();
    const reasons: string[] = [];
    const unsubscribe = onDigestFallback((reason) => {
      reasons.push(reason);
    });
    expect(digestBytes(new Uint8Array())).toBe('ef46db3751d8e999');
    expect(digestBytes(sanity(32))).toBe('18b216492bb44b70');
    expect(reasons).toEqual([]);
    await initDigest();
    expect(digestBytes(sanity(33))).toBe('55c8dc3e578f5b59');
    expect(reasons).toEqual([]);
    unsubscribe();
  });

  it('emits the fallback event once when wasm cannot be used', () => {
    resetXxh64ForTests();
    const reasons: string[] = [];
    onDigestFallback((reason) => {
      reasons.push(reason);
    });
    forceXxh64FallbackForTests('wasm blocked');
    forceXxh64FallbackForTests('again');
    expect(digestBytes(new TextEncoder().encode('abc'))).toBe(
      xxh64BigInt(new TextEncoder().encode('abc'))
    );
    expect(reasons).toEqual(['wasm blocked']);
  });

  it('matches wasm, the BigInt fallback, and the reference', async () => {
    const count = process.env['XXH64_FULL'] === '1' ? 2000 : 200;
    await initDigest();
    const seed = { value: 0x9e3779b1 };
    const wasm: string[] = [];
    for (let index = 0; index < count; index += 1) {
      wasm.push(digestBytes(randomBuffer(seed)));
    }
    resetXxh64ForTests();
    forceXxh64FallbackForTests('compare');
    const again = { value: 0x9e3779b1 };
    for (let index = 0; index < count; index += 1) {
      const bytes = randomBuffer(again);
      const fallback = digestBytes(bytes);
      expect(fallback).toBe(wasm[index]);
      expect(xxh64BigInt(bytes)).toBe(fallback);
    }
  }, 180_000);

  it('matches a worker that imports dist', async () => {
    const dist = new URL('../../dist/index.js', import.meta.url);
    expect(
      existsSync(dist),
      'build @phalanx-engine/runtime before the worker digest test'
    ).toBe(true);
    const runtime = (await import(dist.href)) as {
      digestBytes: (bytes: Uint8Array) => string;
      initDigest: () => Promise<void>;
    };
    await runtime.initDigest();
    const sample = unaligned(sanity(1000), 3);
    const local = runtime.digestBytes(sample);
    const remote = await new Promise<string>((resolve, reject) => {
      const worker = new Worker(new URL('./xxh64Worker.mjs', import.meta.url), {
        workerData: sample,
      });
      worker.once('message', (message: unknown) => {
        if (typeof message !== 'string') {
          reject(new Error('worker digest was not a string'));
          return;
        }
        resolve(message);
      });
      worker.once('error', reject);
    });
    expect(remote).toBe(local);
    expect(local).toBe(xxh64BigInt(sample));
  });
});
