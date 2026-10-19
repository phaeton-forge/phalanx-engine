import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('protocol package', () => {
  it('devDependencies are only typescript and vitest', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(Object.keys(pkg.devDependencies ?? {}).sort()).toEqual([
      'typescript',
      'vitest',
    ]);
  });
});
