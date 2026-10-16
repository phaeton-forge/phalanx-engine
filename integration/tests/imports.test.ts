import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../src/paths.js';

const ALLOWED = [
  /^src\/adapters\//,
  /^src\/facade\//,
  /^src\/suites\/packageSmoke\.ts$/,
];

describe('import rule', () => {
  it('allows @phalanx-engine imports only in the adapter, facade and package smoke', () => {
    const violations: string[] = [];
    for (const file of walk(join(PACKAGE_ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      const imported =
        /from\s+['"]@phalanx-engine\//.test(text) ||
        /import\s*\(\s*['"]@phalanx-engine\//.test(text);
      if (!imported) continue;
      const rel = relative(PACKAGE_ROOT, file).split('\\').join('/');
      if (ALLOWED.some((pattern) => pattern.test(rel))) continue;
      violations.push(rel);
    }
    expect(violations).toEqual([]);
  });
});

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (name.endsWith('.ts')) files.push(path);
  }
  return files;
}
