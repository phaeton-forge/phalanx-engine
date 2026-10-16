import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import { join } from 'node:path';
import { createCurrentDriver } from './adapters/current.js';
import { runConformance } from './adapters/conformance.js';
import type { Capabilities } from './driver/capabilities.js';
import type { SimDriver } from './driver/SimDriver.js';
import { parseScenario, type Scenario } from './dsl/scenario.js';
import { isSimulationFailure, simulate } from './dsl/interpret.js';
import { generateScenario } from './fuzz/generate.js';
import { promoteScenario } from './fuzz/promote.js';
import { shrinkScenario } from './fuzz/shrink.js';
import { PACKAGE_ROOT, REPO_ROOT } from './paths.js';
import { failed, writeReport } from './report/format.js';
import type {
  CaseResult,
  Report,
  ReportHeader,
  Status,
} from './report/types.js';
import { catalog } from './suites/catalog.js';
import { runDetContinuous } from './suites/detContinuous.js';
import { runPackageSmoke } from './suites/packageSmoke.js';
import {
  judgePerf,
  measurePerf,
  readBaseline,
  writeBaseline,
} from './suites/perf.js';
import { loadRegressions } from './suites/regressions.js';
import { runReplay } from './suites/replay.js';
import { exec } from './util/exec.js';
import { errorMessage, parseJson } from './util/json.js';
import { prng } from './util/prng.js';

export interface RunOptions {
  readonly profile: 'quick' | 'full';
  readonly tags: readonly string[];
  readonly scenario?: string;
  readonly seed?: number;
  readonly fuzz?: number;
  readonly promote?: string;
  readonly updateBaseline: boolean;
  readonly out: string;
  readonly pr: string;
  readonly base?: string;
  readonly load?: string;
}

const QUICK_FUZZ = { count: 50, seeds: [1, 2] };
const FULL_FUZZ = { count: 500, seeds: [1, 2, 3, 4] };

export async function runAll(options: RunOptions): Promise<Report> {
  const started = Date.now();
  const driver = createCurrentDriver();
  const cases: CaseResult[] = [];
  const focused =
    options.scenario !== undefined ||
    options.load !== undefined ||
    options.tags.length > 0;
  const regressionsDir = join(PACKAGE_ROOT, 'scenarios', 'regressions');

  if (options.load !== undefined) {
    const loaded = parseScenario(parseJson(readFileSync(options.load, 'utf8')));
    cases.push(await runScenario(driver, loaded));
    if (options.promote !== undefined) {
      const path = promoteScenario(
        { ...loaded, name: options.promote },
        regressionsDir
      );
      cases.push(skipped('promote', 'fuzz', ['fuzz'], `wrote ${path}`));
    }
  } else {
    if (selected(options, 'conformance', ['conformance'], focused)) {
      cases.push(
        await timeCase('conformance', 'conformance', ['conformance'], () =>
          runConformance(driver)
        )
      );
    }
    for (const scenario of catalog()) {
      if (!selected(options, scenario.name, scenario.tags, focused)) continue;
      cases.push(await runScenario(driver, scenario, driver.capabilities));
    }
    if (
      selected(options, 'replay-matches-live', ['replay', 'quick'], focused)
    ) {
      cases.push(
        await timeCase(
          'replay-matches-live',
          'replay',
          ['replay', 'quick'],
          () => runReplay(driver)
        )
      );
    }
    if (
      selected(options, 'det-continuous', ['det-continuous', 'quick'], focused)
    ) {
      const ticks = options.profile === 'full' ? 24 : 6;
      cases.push(
        await timeCase(
          'det-continuous',
          'det-continuous',
          ['det-continuous'],
          () => runDetContinuous(ticks)
        )
      );
    }
    if (
      selected(options, 'package-smoke', ['package-smoke', 'quick'], focused)
    ) {
      cases.push(
        await timeCase(
          'package-smoke',
          'package-smoke',
          ['package-smoke'],
          () => runPackageSmoke()
        )
      );
    }
    if (selected(options, 'perf', ['perf', 'quick'], focused)) {
      cases.push(runPerfCase(driver, options));
    }
    for (const scenario of loadRegressions(regressionsDir)) {
      if (!selected(options, scenario.name, scenario.tags, focused)) continue;
      cases.push(await runScenario(driver, scenario, driver.capabilities));
    }
    if (
      selected(options, 'fuzz', ['fuzz'], focused) ||
      options.fuzz !== undefined
    ) {
      cases.push(...(await runFuzzCases(driver, options)));
    }
  }

  const header = await headerFor(options, Date.now() - started);
  const report: Report = { header, cases };
  writeReport(report, options.out);
  return report;
}

export async function runScenario(
  driver: SimDriver,
  scenario: Scenario,
  capabilities: Capabilities = driver.capabilities
): Promise<CaseResult> {
  const missing = (scenario.requires ?? []).find((name) => !capabilities[name]);
  if (missing !== undefined) {
    return skipped(
      scenario.name,
      scenario.suite,
      scenario.tags,
      `needs capabilities.${missing}`
    );
  }
  const started = Date.now();
  try {
    const result = await simulate(driver, scenario);
    if (scenario.knownFailure !== undefined) {
      return base(
        scenario,
        'warn',
        result.ticks,
        Date.now() - started,
        'known failure now passes — remove tag'
      );
    }
    return base(
      scenario,
      'pass',
      result.ticks,
      Date.now() - started,
      result.note
    );
  } catch (error) {
    const detail = describe(error);
    if (scenario.knownFailure !== undefined) {
      return {
        ...base(
          scenario,
          'known',
          scenario.ticks,
          Date.now() - started,
          scenario.knownFailure
        ),
        ...detail,
        seed: scenario.seed,
      };
    }
    return {
      ...base(
        scenario,
        'fail',
        scenario.ticks,
        Date.now() - started,
        detail.note
      ),
      ...detail,
      seed: scenario.seed,
      repro: reproCommand(scenario.name, scenario.seed),
    };
  }
}

async function runFuzzCases(
  driver: SimDriver,
  options: RunOptions
): Promise<CaseResult[]> {
  const profile = options.profile === 'full' ? FULL_FUZZ : QUICK_FUZZ;
  const count = options.fuzz ?? profile.count;
  const seeds = options.seed === undefined ? profile.seeds : [options.seed];
  const started = Date.now();
  let failures = 0;
  const rows: CaseResult[] = [];
  for (const seed of seeds) {
    const rng = prng(seed);
    for (let index = 0; index < count; index += 1) {
      const scenario = generateScenario(rng, seed, index);
      try {
        await simulate(driver, scenario);
      } catch (error) {
        failures += 1;
        const shrunk = await shrinkScenario(scenario, async (candidate) => {
          try {
            await simulate(driver, candidate);
            return false;
          } catch {
            return true;
          }
        });
        const reproDir = join(options.out, 'repros');
        mkdirSync(reproDir, { recursive: true });
        const reproPath = join(reproDir, `${shrunk.name}.json`);
        writeFileSync(reproPath, `${JSON.stringify(shrunk, null, 2)}\n`);
        if (options.promote !== undefined)
          promoteScenario(
            shrunk,
            join(PACKAGE_ROOT, 'scenarios', 'regressions')
          );
        const detail = describe(error);
        rows.push({
          ...base(shrunk, 'fail', shrunk.ticks, 0, detail.note),
          ...detail,
          seed: shrunk.seed,
          timeline: shrunk.timeline,
          repro: `pnpm --filter @phalanx-engine/integration run it -- --load ${reproPath}`,
        });
      }
    }
  }
  const status: Status = failures === 0 ? 'pass' : 'fail';
  rows.unshift(
    base(
      {
        name: 'fuzz',
        suite: 'fuzz',
        tags: ['fuzz'],
        seed: seeds[0] ?? 0,
        ticks: count,
      },
      status,
      count * seeds.length,
      Date.now() - started,
      `${String(count * seeds.length - failures)}/${String(count * seeds.length)} timelines`
    )
  );
  return rows;
}

function runPerfCase(driver: SimDriver, options: RunOptions): CaseResult {
  const counts = options.profile === 'full' ? [150, 500] : [150];
  const path = join(PACKAGE_ROOT, 'baselines', 'perf.json');
  const started = Date.now();
  const samples = measurePerf(driver, counts);
  if (options.updateBaseline) writeBaseline(path, samples);
  const judged = judgePerf(samples, readBaseline(path), options.updateBaseline);
  return {
    ...base(
      { name: 'perf', suite: 'perf', tags: ['perf'], seed: 1, ticks: 12 },
      judged.status,
      12,
      Date.now() - started,
      judged.note
    ),
    perf: judged.rows,
  };
}

async function timeCase(
  name: string,
  suite: string,
  tags: readonly string[],
  body: () => Promise<void>
): Promise<CaseResult> {
  const started = Date.now();
  try {
    await body();
    return base(
      { name, suite, tags, seed: 0, ticks: 0 },
      'pass',
      0,
      Date.now() - started,
      ''
    );
  } catch (error) {
    const message = errorMessage(error);
    if (message.startsWith('skip:')) {
      return skipped(name, suite, tags, message.slice(5).trim());
    }
    return {
      ...base(
        { name, suite, tags, seed: 0, ticks: 0 },
        'fail',
        0,
        Date.now() - started,
        message
      ),
      repro: reproCommand(name, 0),
    };
  }
}

function selected(
  options: RunOptions,
  name: string,
  tags: readonly string[],
  focused: boolean
): boolean {
  if (options.scenario !== undefined) return options.scenario === name;
  if (options.tags.length > 0) {
    return options.tags.some((tag) => tags.includes(tag));
  }
  if (focused) return false;
  if (
    options.profile === 'quick' &&
    tags.includes('full') &&
    !tags.includes('quick')
  ) {
    return false;
  }
  return true;
}

function skipped(
  name: string,
  suite: string,
  tags: readonly string[],
  note: string
): CaseResult {
  return base({ name, suite, tags, seed: 0, ticks: 0 }, 'skip', 0, 0, note);
}

function base(
  scenario: {
    name: string;
    suite: string;
    tags: readonly string[];
    seed: number;
    ticks: number;
  },
  status: Status,
  ticks: number,
  timeMs: number,
  note: string
): CaseResult {
  return {
    name: scenario.name,
    suite: scenario.suite,
    tags: scenario.tags,
    status,
    ticks,
    timeMs,
    note,
    seed: scenario.seed,
  };
}

function describe(error: unknown): Pick<CaseResult, 'note' | 'tick' | 'diffs'> {
  if (isSimulationFailure(error)) {
    return {
      note: error.message,
      ...(error.tick === undefined ? {} : { tick: error.tick }),
      diffs: error.diffs,
    };
  }
  return { note: errorMessage(error) };
}

function reproCommand(name: string, seed: number): string {
  return `pnpm --filter @phalanx-engine/integration run it -- --scenario ${name} --seed ${seed}`;
}

async function headerFor(
  options: RunOptions,
  durationMs: number
): Promise<ReportHeader> {
  const cpu = cpus()[0]?.model ?? '';
  return {
    pr: options.pr,
    head: await git(['rev-parse', 'HEAD']),
    base: options.base ?? (await git(['rev-parse', 'origin/main'])),
    node: process.version,
    pnpm: await pnpmVersion(),
    os: `${platform()} ${release()} ${arch()} ${cpu}`.trim(),
    profile: options.profile,
    seeds: options.seed === undefined ? [] : [options.seed],
    durationMs,
  };
}

async function git(args: readonly string[]): Promise<string> {
  try {
    return (await exec('git', args, REPO_ROOT)).trim();
  } catch {
    return 'unknown';
  }
}

async function pnpmVersion(): Promise<string> {
  try {
    return (await exec('pnpm', ['--version'], REPO_ROOT)).trim();
  } catch {
    return 'unknown';
  }
}

export function exitCode(report: Report): number {
  return failed(report) ? 1 : 0;
}
