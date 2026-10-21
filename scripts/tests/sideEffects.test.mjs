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
