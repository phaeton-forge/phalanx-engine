import { describe, expect, it } from 'vitest';
import { formatMarkdown } from '../src/report/format.js';
import type { Report } from '../src/report/types.js';

describe('report', () => {
  it('renders status glyphs and a diff', () => {
    const report: Report = {
      header: {
        pr: '66',
        head: 'abc',
        base: 'def',
        node: 'v22.14.0',
        pnpm: '10.33.2',
        os: 'linux',
        profile: 'quick',
        seeds: [1],
        durationMs: 1500,
      },
      cases: [
        {
          name: 'ok',
          suite: 'disconnect',
          tags: ['quick'],
          status: 'pass',
          ticks: 4,
          timeMs: 10,
          note: '',
        },
        {
          name: 'hand-off',
          suite: 'disconnect',
          tags: ['quick'],
          status: 'skip',
          ticks: 0,
          timeMs: 0,
          note: 'needs capabilities.setController',
        },
        {
          name: 'desync',
          suite: 'fuzz',
          tags: ['fuzz'],
          status: 'fail',
          ticks: 6,
          timeMs: 20,
          note: 'peer A diverged at tick 4',
          seed: 1,
          tick: 4,
          diffs: [
            {
              entity: '1',
              component: 'Gas',
              field: 'health',
              peer: '101',
              reference: '100',
            },
          ],
          repro:
            'pnpm --filter @phalanx-engine/integration run it -- --scenario desync --seed 1',
        },
      ],
    };
    const markdown = formatMarkdown(report);
    expect(markdown).toContain('✅');
    expect(markdown).toContain('⚠️');
    expect(markdown).toContain('❌');
    expect(markdown).toContain('peer A diverged at tick 4');
    expect(markdown).toContain('First diverging tick: 4');
  });
});
