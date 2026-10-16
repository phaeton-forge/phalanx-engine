import { join } from 'node:path';
import { PACKAGE_ROOT } from './paths.js';
import { exitCode, runAll, type RunOptions } from './run.js';
import { errorMessage } from './util/json.js';

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await runAll(options);
  const fails = report.cases.filter((row) => row.status === 'fail').length;
  process.stdout.write(
    `${report.cases.length} cases, ${String(fails)} failed, report ${join(options.out, 'report.md')}\n`
  );
  if (exitCode(report) !== 0) process.exitCode = 1;
}

function parseArgs(argv: readonly string[]): RunOptions {
  let profile: RunOptions['profile'] = 'quick';
  let tags: string[] = [];
  let scenario: string | undefined;
  let seed: number | undefined;
  let fuzz: number | undefined;
  let promote: string | undefined;
  let updateBaseline = false;
  let out = join(PACKAGE_ROOT, 'out');
  let pr = '—';
  let base: string | undefined;
  let load: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--update-baseline') {
      updateBaseline = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`missing value for ${arg ?? ''}`);
    index += 1;
    if (arg === '--profile') {
      if (value !== 'quick' && value !== 'full') {
        throw new Error('--profile must be quick or full');
      }
      profile = value;
      continue;
    }
    if (arg === '--tag') {
      tags = value.split(',').filter((tag) => tag !== '');
      continue;
    }
    if (arg === '--scenario') {
      scenario = value;
      continue;
    }
    if (arg === '--seed') {
      seed = integer(value, '--seed');
      continue;
    }
    if (arg === '--fuzz') {
      fuzz = integer(value, '--fuzz');
      continue;
    }
    if (arg === '--promote') {
      promote = value;
      continue;
    }
    if (arg === '--out') {
      out = value;
      continue;
    }
    if (arg === '--pr') {
      pr = value;
      continue;
    }
    if (arg === '--base') {
      base = value;
      continue;
    }
    if (arg === '--load') {
      load = value;
      continue;
    }
    throw new Error(`unknown argument ${arg ?? ''}`);
  }
  return {
    profile,
    tags,
    ...(scenario === undefined ? {} : { scenario }),
    ...(seed === undefined ? {} : { seed }),
    ...(fuzz === undefined ? {} : { fuzz }),
    ...(promote === undefined ? {} : { promote }),
    updateBaseline,
    out,
    pr,
    ...(base === undefined ? {} : { base }),
    ...(load === undefined ? {} : { load }),
  };
}

function integer(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${flag} must be an integer`);
  return parsed;
}

main().catch((error: unknown) => {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
});
