import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkSideEffects, findImportWork } from '../side-effects.mjs';

test('declarations, imports and exports are not import work', () => {
  const source = [
    "import { a } from './a.js';",
    "export { b } from './b.js';",
    'export const table = new Uint8Array(4);',
    'let counter = 0;',
    'export function next() { return ++counter; }',
    'export class Box {}',
    'export interface Shape { x: number }',
    'export type Id = number;',
    'enum Mode { A }',
    'export default Box;',
  ].join('\n');
  assert.deepEqual(findImportWork(source, 'clean.ts'), []);
});

test('top-level calls, assignments and loops are import work', () => {
  const source = [
    "import { setHost } from './host.js';",
    'setHost(1);',
    'globalThis.x = 1;',
    'for (let i = 0; i < 2; i += 1) {}',
    'if (Math.random() > 2) {}',
  ].join('\n');
  assert.deepEqual(findImportWork(source, 'dirty.ts'), [
    'dirty.ts:2: setHost(1);',
    'dirty.ts:3: globalThis.x = 1;',
    'dirty.ts:4: for (let i = 0; i < 2; i += 1) {}',
    'dirty.ts:5: if (Math.random() > 2) {}',
  ]);
});

test('imported calls and assignments hidden in initializers are import work', () => {
  const source = [
    "import { setHost, Host } from './host.js';",
    "import * as host from './host.js';",
    'const alias = setHost;',
    'const installed = setHost(1);',
    'const viaNs = host.set(1);',
    'const viaAlias = alias(1);',
    'const written = (globalThis.x = 1);',
    'const made = new Host();',
    'const iife = (() => setHost(2))();',
    'export class Box { static { setHost(3); } }',
    'namespace Boot { const n = setHost(4); }',
  ].join('\n');
  assert.deepEqual(findImportWork(source, 'hidden.ts'), [
    'hidden.ts:4: setHost(1)',
    'hidden.ts:5: host.set(1)',
    'hidden.ts:6: alias(1)',
    'hidden.ts:7: globalThis.x = 1',
    'hidden.ts:8: new Host()',
    'hidden.ts:9: setHost(2)',
    'hidden.ts:10: setHost(3);',
    'hidden.ts:11: setHost(4)',
  ]);
});

test('an alias stays inside the block that declared it', () => {
  const source = [
    "import { setHost } from './host.js';",
    'namespace Boot { const alias = setHost; const n = alias(1); }',
    'const later = alias(2);',
    'export class Box { static { const alias = setHost; const n = alias(3); } }',
  ].join('\n');
  assert.deepEqual(findImportWork(source, 'scope.ts'), [
    'scope.ts:2: alias(1)',
    'scope.ts:4: alias(3)',
  ]);
});

test('a local function that calls an import is import work', () => {
  const source = [
    "import { setHost } from './host.js';",
    'function install(){ setHost(x) }',
    'install();',
  ].join('\n');
  assert.deepEqual(findImportWork(source, 'install.ts'), [
    'install.ts:2: setHost(x)',
  ]);
});

test('a local arrow called from an initializer is import work', () => {
  const source = [
    "import { g } from './g.js';",
    'const f=()=>g();',
    'export const v=f();',
  ].join('\n');
  assert.deepEqual(findImportWork(source, 'arrow.ts'), ['arrow.ts:2: g()']);
});

test('destructuring an imported value taints the binding', () => {
  const source = [
    "import * as m from './host.js';",
    'const { setHost } = m;',
    'setHost(1);',
    'const called = setHost(2);',
  ].join('\n');
  assert.deepEqual(findImportWork(source, 'destructure.ts'), [
    'destructure.ts:3: setHost(1);',
    'destructure.ts:4: setHost(2)',
  ]);
});

test('a local function may fill a local value', () => {
  const source = [
    'function fill() {',
    '  const table = new Uint8Array(4);',
    '  for (let index = 0; index < 4; index += 1) table[index] = index;',
    '  return table;',
    '}',
    'const bytes = fill();',
  ].join('\n');
  assert.deepEqual(findImportWork(source, 'fill.ts'), []);
});

test('local calls and new expressions are not import work', () => {
  const source = [
    "import { LABEL } from './label.js';",
    'function decode(value) { return value.length; }',
    'const bytes = decode(LABEL);',
    'const table = Uint8Array.from(LABEL, (char) => char.charCodeAt(0));',
    'const made = new Uint8Array(4);',
    'export class Box { ready() { decode(LABEL); } }',
    'export function next() { return decode(LABEL); }',
    'namespace Local { export const n = decode(LABEL); }',
    'const built = (() => new Uint8Array(1))();',
  ].join('\n');
  assert.deepEqual(findImportWork(source, 'local.ts'), []);
});

test('checks packages that set sideEffects and skips listed entry files', () => {
  const root = mkdtempSync(join(tmpdir(), 'side-effects-'));
  try {
    const write = (path, text) => {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    write(
      'phalanx-pure/package.json',
      JSON.stringify({
        name: 'pure',
        sideEffects: ['./dist/worker.js'],
      })
    );
    write('phalanx-pure/src/index.ts', 'export const a = 1;\n');
    write('phalanx-pure/src/worker.ts', 'process.on("message", () => {});\n');
    write('phalanx-pure/src/deep/bad.ts', 'register();\n');
    write('phalanx-loose/package.json', JSON.stringify({ name: 'loose' }));
    write('phalanx-loose/src/index.ts', 'register();\n');

    const result = checkSideEffects(root);
    assert.deepEqual(result.checked, ['pure']);
    assert.deepEqual(result.found, [
      join('phalanx-pure', 'src', 'deep', 'bad.ts') + ':1: register();',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
