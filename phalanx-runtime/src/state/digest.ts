/**
 * xxHash64 (XXH64) with seed 0, as lowercase hex (16 characters).
 *
 * The hot path is the embedded WASM module ({@link initDigest}). A
 * cold call compiles that module synchronously. When `WebAssembly`
 * cannot be compiled, hashing falls back to the BigInt reference.
 * Both paths return the same digest. A real compile failure emits one
 * {@link onDigestFallback} event per process. An in-flight async
 * compile uses the BigInt reference without that event.
 *
 * This is XXH64, not XXH3. The digest covers the bytes it is given and
 * nothing else; snapshot code hashes the `GameState` body only.
 */

import { xxh64BigInt } from './xxh64BigInt.js';
import { initXxh64, onXxh64Fallback, xxh64WasmHex } from './xxh64Wasm.js';

export type DigestFallbackHandler = (reason: string) => void;

/**
 * Compile the XXH64 module. Idempotent. The module is under 4 KB, so
 * this compiles synchronously on Node, worker threads, and browser
 * main threads. A larger module would wait for `WebAssembly.compile`
 * in the browser and keep the BigInt fallback until then.
 */
export function initDigest(): Promise<void> {
  return initXxh64();
}

/**
 * One event when the XXH64 module fails to compile.
 * Not `console`. Subscribe before the first hash to observe it.
 * A cold hash compiles synchronously and does not emit this.
 */
export function onDigestFallback(handler: DigestFallbackHandler): () => void {
  return onXxh64Fallback(handler);
}

export function digestBytes(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('digestBytes: expected a Uint8Array');
  }
  const wasm = xxh64WasmHex(bytes);
  if (wasm !== null) return wasm;
  return xxh64BigInt(bytes);
}
