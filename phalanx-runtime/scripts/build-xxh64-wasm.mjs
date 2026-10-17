/**
 * Compile src/state/xxh64.wat into the base64 embedded in
 * src/state/xxh64WasmBytes.ts. Requires the `wabt` devDependency.
 * `pnpm build` does not run this; the bytes are committed.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const wabt = require('wabt');
const toolkit = await wabt();
const watPath = new URL('../src/state/xxh64.wat', import.meta.url);
const wat = readFileSync(watPath, 'utf8');
const parsed = toolkit.parseWat('xxh64.wat', wat);
parsed.validate();
const { buffer } = parsed.toBinary({ write_debug_names: false });
parsed.destroy();
const base64 = Buffer.from(buffer).toString('base64');
const out = `/**
 * XXH64 module bytes. Generated from \`xxh64.wat\` by
 * \`scripts/build-xxh64-wasm.mjs\`. Do not edit by hand.
 */
export const XXH64_WASM_BASE64 =
  '${base64}';
`;
writeFileSync(new URL('../src/state/xxh64WasmBytes.ts', import.meta.url), out);
process.stdout.write(`xxh64 wasm ${String(buffer.byteLength)} bytes\n`);
