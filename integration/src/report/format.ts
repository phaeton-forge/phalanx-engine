import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaseResult, Report, Status } from './types.js';

export function writeReport(report: Report, directory: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'report.md'), formatMarkdown(report), 'utf8');
  writeFileSync(
    join(directory, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
  );
}

export function formatMarkdown(report: Report): string {
  const header = report.header;
  const lines: string[] = [
    '# Integration report',
    '',
    `| | |`,
    `| --- | --- |`,
    `| PR | ${header.pr} |`,
    `| Head | ${header.head} |`,
    `| Base | ${header.base} |`,
    `| Node | ${header.node} |`,
    `| pnpm | ${header.pnpm} |`,
    `| OS | ${header.os} |`,
    `| Profile | ${header.profile} |`,
    `| Seeds | ${header.seeds.join(', ') || '—'} |`,
    `| Duration | ${(header.durationMs / 1000).toFixed(1)}s |`,
    '',
    '| scenario | suite | tags | status | ticks | time | note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of report.cases) {
    lines.push(
      `| ${cell(row.name)} | ${cell(row.suite)} | ${cell(row.tags.join(', '))} | ${glyph(row.status)} | ${String(row.ticks)} | ${row.timeMs.toFixed(0)}ms | ${cell(row.note)} |`
    );
  }
  const failures = report.cases.filter(
    (row) => row.status === 'fail' || row.status === 'known'
  );
  if (failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const row of failures) lines.push(...failureBlock(row));
  }
  const perf = report.cases.flatMap((row) => row.perf ?? []);
  if (perf.length > 0) {
    lines.push(
      '',
      '## Perf',
      '',
      '| metric | baseline | current | Δ% |',
      '| --- | --- | --- | --- |'
    );
    for (const row of perf) {
      const baseline = row.baseline === null ? '—' : String(row.baseline);
      const delta = row.deltaPct === null ? '—' : row.deltaPct.toFixed(1);
      lines.push(
        `| ${cell(row.metric)} | ${baseline} | ${String(row.current)} | ${delta} |`
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function failureBlock(row: CaseResult): string[] {
  const lines = [`### ${row.name}`, '', row.note, ''];
  if (row.tick !== undefined)
    lines.push(`First diverging tick: ${String(row.tick)}`, '');
  if (row.seed !== undefined) lines.push(`Seed: ${String(row.seed)}`, '');
  if (row.diffs !== undefined && row.diffs.length > 0) {
    lines.push(
      '| entity | component | field | peer | reference |',
      '| --- | --- | --- | --- | --- |'
    );
    for (const diff of row.diffs) {
      lines.push(
        `| ${cell(diff.entity)} | ${cell(diff.component)} | ${cell(diff.field)} | ${cell(diff.peer)} | ${cell(diff.reference)} |`
      );
    }
    lines.push('');
  }
  if (row.timeline !== undefined) {
    lines.push(
      'Minimized timeline:',
      '',
      '```json',
      JSON.stringify(row.timeline, null, 2),
      '```',
      ''
    );
  }
  if (row.repro !== undefined) lines.push('```', row.repro, '```', '');
  return lines;
}

function glyph(status: Status): string {
  if (status === 'pass') return '✅';
  if (status === 'fail') return '❌';
  if (status === 'known') return '❌ known';
  return '⚠️';
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function failed(report: Report): boolean {
  return report.cases.some((row) => row.status === 'fail');
}
