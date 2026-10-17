import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import { join } from 'node:path';
import { createCurrentDriver } from './adapters/current.js';
import { runConformance } from './adapters/conformance.js';
import type { Capabilities } from './driver/capabilities.js';
import type { SimDriver } from './driver/SimDriver.js';
import { parseScenario, type Scenario } from './dsl/scenario.js';
import { isSimulationFailure, simulate } from './dsl/interpret.js';
import { generateScenario, injectScenario } from './fuzz/generate.js';
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
  try {
    return await runCases(options, driver, cases, started);
  } catch (error) {
    cases.push(
      base(
        {
          name: 'runner',
          suite: 'runner',
          tags: ['runner'],
          seed: options.seed ?? 0,
          ticks: 0,
        },
        'fail',
        0,
        Date.now() - started,
        errorMessage(error)
      )
    );
    throw error;
  } finally {
    const header = await headerFor(options, Date.now() - started);
    writeReport({ header, cases }, options.out);
  }
}

async function runCases(
  options: RunOptions,
  driver: SimDriver,
  cases: CaseResult[],
  started: number
): Promise<Report> {
  const focused =
    options.scenario !== undefined ||
    options.load !== undefined ||
    options.tags.length > 0;
  const regressionsDir = join(PACKAGE_ROOT, 'scenarios', 'regressions');

  if (options.load !== undefined) {
    const loaded = parseScenario(parseJson(readFileSync(options.load, 'utf8')));
    cases.push(await runScenario(driver, withRequestedSeed(loaded, options)));
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
      cases.push(
        await runScenario(
          driver,
          withRequestedSeed(scenario, options),
          driver.capabilities
        )
      );
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
      const ticks = options.profile === 'full' ? 3000 : 600;
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
      cases.push(
        await runScenario(
          driver,
          withRequestedSeed(scenario, options),
          driver.capabilities
        )
      );
    }
    if (selected(options, 'inject-shrink', ['fuzz', 'inject'], focused)) {
      cases.push(
        await timeCase('inject-shrink', 'fuzz', ['fuzz', 'inject'], () =>
          assertInjectShrink()
        )
      );
    }
    if (
      selected(options, 'fuzz', ['fuzz'], focused) ||
      options.fuzz !== undefined
    ) {
      cases.push(...(await runFuzzCases(driver, options)));
    }
  }

  const header = await headerFor(options, Date.now() - started);
  return { header, cases };
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
    if (scenario.expect.diverges === true) {
      return base(
        scenario,
        'fail',
        scenario.ticks,
        Date.now() - started,
        'expected divergence but the scenario converged'
      );
    }
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
    if (scenario.expect.diverges === true && detail.note.includes('diverged')) {
      return base(
        scenario,
        'pass',
        scenario.ticks,
        Date.now() - started,
        detail.note
      );
    }
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

async function assertInjectShrink(): Promise<void> {
  const driver = createCurrentDriver();
  const scenario = injectScenario(11);
  if (scenario.timeline.length < 15 || scenario.timeline.length > 20) {
    throw new Error(
      `inject shrink started from ${String(scenario.timeline.length)} events`
    );
  }
  await simulate(driver, scenario).then(
    () => {
      throw new Error('inject scenario converged');
    },
    (error: unknown) => {
      if (!errorMessage(error).includes('diverged')) throw error;
    }
  );
  const shrunk = await shrinkScenario(scenario, async (candidate) => {
    try {
      await simulate(driver, candidate);
      return false;
    } catch (error) {
      return errorMessage(error).includes('diverged');
    }
  });
  if (shrunk.timeline.length > 5) {
    throw new Error(
      `inject shrink left ${String(shrunk.timeline.length)} events`
    );
  }
  if (!shrunk.timeline.some((event) => event.op === 'inject')) {
    throw new Error('inject shrink dropped the inject');
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
      if (scenario.expect.diverges === true) {
        const outcome = await divergenceOutcome(driver, scenario);
        if (outcome.kind !== 'diverged') {
          failures += 1;
          const error =
            outcome.kind === 'converged'
              ? new Error('expected divergence but the scenario converged')
              : outcome.error;
          await recordFuzzFailure(
            options,
            scenario,
            error,
            async (candidate) =>
              injectMissPersists(
                driver,
                candidate,
                outcome.kind === 'converged' ? 'converged' : 'threw',
                errorMessage(error)
              ),
            rows
          );
        }
        continue;
      }
      try {
        await simulate(driver, scenario);
      } catch (error) {
        failures += 1;
        await recordFuzzFailure(
          options,
          scenario,
          error,
          async (candidate) => {
            try {
              await simulate(driver, candidate);
              return false;
            } catch {
              return true;
            }
          },
          rows
        );
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

type DivergenceKind = 'diverged' | 'converged' | 'threw';

async function divergenceOutcome(
  driver: SimDriver,
  scenario: Scenario
): Promise<{ kind: DivergenceKind; error?: unknown }> {
  try {
    await simulate(driver, scenario);
    return { kind: 'converged' };
  } catch (error) {
    if (errorMessage(error).includes('diverged')) return { kind: 'diverged' };
    return { kind: 'threw', error };
  }
}

/**
 * Shrink predicate for an inject case that did not diverge.
 * Convergence stays a miss only while the candidate still fails to
 * diverge. A thrown miss stays a miss only while the candidate throws
 * the same failure, not a clean divergence and not a quiet pass.
 */
export async function injectMissPersists(
  driver: SimDriver,
  candidate: Scenario,
  expectation: 'converged' | 'threw',
  originalMessage: string
): Promise<boolean> {
  try {
    await simulate(driver, candidate);
    return expectation === 'converged';
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes('diverged')) return false;
    if (expectation === 'converged') return true;
    const prefix = originalMessage.split(' at tick ')[0] ?? originalMessage;
    return prefix !== '' && message.includes(prefix);
  }
}

async function recordFuzzFailure(
  options: RunOptions,
  scenario: Scenario,
  error: unknown,
  persists: (candidate: Scenario) => Promise<boolean>,
  rows: CaseResult[]
): Promise<void> {
  const shrunk = await shrinkScenario(scenario, persists);
  const reproDir = join(options.out, 'repros');
  mkdirSync(reproDir, { recursive: true });
  const reproPath = join(reproDir, `${shrunk.name}.json`);
  writeFileSync(reproPath, `${JSON.stringify(shrunk, null, 2)}\n`);
  if (options.promote !== undefined) {
    promoteScenario(shrunk, join(PACKAGE_ROOT, 'scenarios', 'regressions'));
  }
  const detail = describe(error);
  rows.push({
    ...base(shrunk, 'fail', shrunk.ticks, 0, detail.note),
    ...detail,
    seed: shrunk.seed,
    timeline: shrunk.timeline,
    repro: `pnpm --filter @phalanx-engine/integration run it -- --load ${reproPath}`,
  });
}

function runPerfCase(driver: SimDriver, options: RunOptions): CaseResult {
  const counts = options.profile === 'full' ? [150, 500] : [150];
  const path = join(PACKAGE_ROOT, 'baselines', 'perf.json');
  const started = Date.now();
  try {
    const baseline = readBaseline(path);
    let samples = measurePerf(driver, counts);
    if (options.updateBaseline) writeBaseline(path, samples);
    let judged = judgePerf(samples, readBaseline(path), options.updateBaseline);
    if (judged.status === 'fail' && !options.updateBaseline) {
      samples = measurePerf(driver, counts);
      const again = judgePerf(samples, baseline, false);
      if (again.status !== 'fail') {
        judged = {
          ...again,
          note:
            again.note === ''
              ? 'first perf sample tripped the gate; repeat passed'
              : again.note,
        };
      }
    }
    return {
      ...base(
        { name: 'perf', suite: 'perf', tags: ['perf'], seed: 1, ticks: 300 },
        judged.status,
        300,
        Date.now() - started,
        judged.note
      ),
      perf: judged.rows,
    };
  } catch (error) {
    return base(
      { name: 'perf', suite: 'perf', tags: ['perf'], seed: 1, ticks: 300 },
      'fail',
      300,
      Date.now() - started,
      errorMessage(error)
    );
  }
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

function withRequestedSeed(scenario: Scenario, options: RunOptions): Scenario {
  if (options.seed === undefined) return scenario;
  return { ...scenario, seed: options.seed };
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
