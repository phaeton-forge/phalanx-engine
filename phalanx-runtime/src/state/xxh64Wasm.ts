import { XXH64_WASM_BASE64 } from './xxh64WasmBytes.js';

/**
 * Own XXH64 module (seed 0). 623 bytes, under the 4 KB limit for
 * synchronous `WebAssembly.Module` on a browser main thread.
 * Chromium refuses synchronous compilation above 4 KB on that thread.
 */
const SYNC_COMPILE_LIMIT = 4096;

const BASE64_ALPHA =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const WASM_BYTES = decodeBase64(XXH64_WASM_BASE64);

type HashExport = (length: number) => bigint;

interface WasmMemory {
  readonly buffer: ArrayBuffer;
  grow(delta: number): number;
}

interface WasmModule {
  readonly brand?: never;
}

interface WasmInstance {
  readonly exports: Record<string, unknown>;
}

interface WasmNamespace {
  Module: new (bytes: Uint8Array) => WasmModule;
  Instance: new (module: WasmModule) => WasmInstance;
  compile(bytes: Uint8Array): Promise<WasmModule>;
}

interface WasmBackend {
  hash(bytes: Uint8Array): bigint;
}

type Mode = 'cold' | 'ready' | 'fallback';

let mode: Mode = 'cold';
let backend: WasmBackend | null = null;
let initPromise: Promise<void> | null = null;
let warned = false;
let fallbackReason: string | null = null;
const listeners = new Set<(reason: string) => void>();

/** Byte length of the embedded module. Tests lock this at <= 4096. */
export function xxh64WasmByteLength(): number {
  return WASM_BYTES.byteLength;
}

/**
 * One-shot notice that hashing fell back to BigInt. Later subscribers
 * are not replayed; the event fires once per process.
 */
export function onXxh64Fallback(handler: (reason: string) => void): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

/** Idempotent. Sync when the module is at most {@link SYNC_COMPILE_LIMIT}. */
export function initXxh64(): Promise<void> {
  if (mode === 'ready' || mode === 'fallback') return Promise.resolve();
  if (initPromise !== null) return initPromise;
  const wasm = wasmNamespace();
  if (wasm === undefined) {
    fail('WebAssembly is not available');
    return Promise.resolve();
  }
  if (browserHost() && WASM_BYTES.byteLength > SYNC_COMPILE_LIMIT) {
    const pending = wasm.compile(WASM_BYTES).then(
      (module) => {
        install(module);
      },
      (error: unknown) => {
        fail(errorText(error));
      }
    );
    initPromise = pending.catch((error: unknown) => {
      fail(errorText(error));
    });
    return initPromise;
  }
  try {
    install(new wasm.Module(WASM_BYTES));
  } catch (error) {
    fail(errorText(error));
  }
  return Promise.resolve();
}

/**
 * Lowercase hex, or `null` when {@link initXxh64} has not finished.
 * A `null` result emits the fallback event once. Hashing does not
 * compile the module; callers use the BigInt fallback until init.
 */
export function xxh64WasmHex(bytes: Uint8Array): string | null {
  if (mode !== 'ready' || backend === null) {
    noteFallback(
      mode === 'cold'
        ? 'XXH64 wasm is not initialized'
        : (fallbackReason ?? 'XXH64 wasm is unavailable')
    );
    return null;
  }
  return hex64(backend.hash(bytes));
}

/** Test hook. Drops the compiled instance. */
export function resetXxh64ForTests(): void {
  mode = 'cold';
  backend = null;
  initPromise = null;
  warned = false;
  fallbackReason = null;
  listeners.clear();
}

/** Test hook. The next hash uses BigInt and emits `reason` once. */
export function forceXxh64FallbackForTests(reason: string): void {
  backend = null;
  mode = 'fallback';
  initPromise = Promise.resolve();
  noteFallback(reason);
}

function install(module: WasmModule): void {
  const wasm = wasmNamespace();
  if (wasm === undefined) {
    throw new Error('WebAssembly is not available');
  }
  const instance = new wasm.Instance(module);
  const memoryExport: unknown = instance.exports['memory'];
  const hashExport: unknown = instance.exports['xxh64'];
  if (!isMemory(memoryExport) || !isHash(hashExport)) {
    throw new Error('XXH64 wasm exports are missing');
  }
  const memory = memoryExport;
  const hash = hashExport;
  let view = new Uint8Array(memory.buffer);
  backend = {
    hash(bytes: Uint8Array): bigint {
      const byteLength = bytes.byteLength;
      const pages = memory.buffer.byteLength / 65536;
      const need = byteLength === 0 ? 1 : Math.ceil(byteLength / 65536);
      if (need > pages) memory.grow(need - pages);
      if (view.byteLength !== memory.buffer.byteLength) {
        view = new Uint8Array(memory.buffer);
      }
      view.set(bytes);
      return hash(byteLength);
    },
  };
  mode = 'ready';
  fallbackReason = null;
}

function fail(reason: string): void {
  mode = 'fallback';
  backend = null;
  noteFallback(reason);
}

function noteFallback(reason: string): void {
  if (warned) return;
  warned = true;
  fallbackReason = reason;
  for (const handler of listeners) handler(reason);
}

function isHash(value: unknown): value is HashExport {
  return typeof value === 'function';
}

function isMemory(value: unknown): value is WasmMemory {
  if (typeof value !== 'object' || value === null) return false;
  const memory = value as { buffer?: unknown; grow?: unknown };
  return (
    memory.buffer instanceof ArrayBuffer && typeof memory.grow === 'function'
  );
}

function wasmNamespace(): WasmNamespace | undefined {
  const host = globalThis as { WebAssembly?: WasmNamespace };
  return host.WebAssembly;
}

function browserHost(): boolean {
  const host = globalThis as Record<string, unknown>;
  return host['window'] !== undefined || host['document'] !== undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'WebAssembly compile failed';
}

function hex64(value: bigint): string {
  return (value & 0xffffffffffffffffn).toString(16).padStart(16, '0');
}

function decodeBase64(value: string): Uint8Array {
  const table = new Uint8Array(128);
  table.fill(255);
  for (let index = 0; index < BASE64_ALPHA.length; index += 1) {
    table[BASE64_ALPHA.charCodeAt(index)] = index;
  }
  const clean = value.replace(/=+$/u, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let count = 0;
  let written = 0;
  for (let index = 0; index < clean.length; index += 1) {
    const code = clean.charCodeAt(index);
    const six = code < 128 ? table[code] : 255;
    if (six === undefined || six === 255) {
      throw new Error('XXH64 wasm: invalid base64');
    }
    bits = (bits << 6) | six;
    count += 6;
    if (count >= 8) {
      count -= 8;
      const byte = out[written];
      if (byte === undefined) {
        throw new Error('XXH64 wasm: base64 length mismatch');
      }
      out[written] = (bits >> count) & 0xff;
      written += 1;
    }
  }
  return out;
}
