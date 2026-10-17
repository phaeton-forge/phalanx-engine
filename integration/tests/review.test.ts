import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createV65Driver } from '../src/adapters/v65.js';
import type { LogEntry, SimDriver } from '../src/driver/SimDriver.js';
import {
  scenario,
  type Scenario,
  type TimelineEvent,
} from '../src/dsl/scenario.js';
import { simulate } from '../src/dsl/interpret.js';
import { generateScenario, injectScenario } from '../src/fuzz/generate.js';
import { injectMissPersists, runAll, type RunOptions } from '../src/run.js';
import { catalog } from '../src/suites/catalog.js';
import { prng } from '../src/util/prng.js';

describe('expected failure', () => {
  it('accepts the engine exception and rejects a suppressed one', async () => {
    const driver = createV65Driver();
    const throwing = named('throwing-system');
    const exploded = await simulate(driver, throwing);
    expect(exploded.note).toContain('skirmish tick exploded');
    for (const name of [
      'schema-change',
      'schema-field-swap',
      'schema-field-type',
    ]) {
      const item = named(name);
      await expect(simulate(driver, item)).resolves.toMatchObject({
        ticks: item.ticks,
      });
    }
    const suppressed: Scenario = {
      ...throwing,
      name: 'throwing-system-suppressed',
      options: { suppressThrow: true },
    };
    await expect(simulate(driver, suppressed)).rejects.toThrow(
      /^scenario completed without the expected failure$/
    );
  });
});

describe('fault delivery order', () => {
  it('submits a later tick before the withheld earlier tick', async () => {
    const delivered: number[] = [];
    const driver = recordingDriver(createV65Driver(), delivered);
    await simulate(
      driver,
      scenario('reorder-wire', {
        suite: 'network',
        tags: ['network'],
        seed: 1,
        ticks: 12,
        slots: ['human'],
        peers: ['A', 'B'],
        timeline: [
          {
            op: 'faults',
            from: 1,
            to: 10,
            peer: 'B',
            delay: [2, 2],
            dup: 0,
            reorder: 1,
            drop: 0,
          },
        ],
        inputs: 'scripted:always',
        expect: { converge: true },
      })
    );
    let inverted = false;
    for (let index = 1; index < delivered.length; index += 1) {
      const previous = delivered[index - 1];
      const current = delivered[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        current < previous
      ) {
        inverted = true;
      }
    }
    expect(inverted).toBe(true);
  });
});

describe('live reference pause', () => {
  it('keeps scripted commands aligned across a pause', async () => {
    const driver = createV65Driver();
    await expect(
      simulate(
        driver,
        scenario('pause-live-ref', {
          suite: 'adversarial',
          tags: ['adversarial'],
          seed: 4,
          ticks: 8,
          slots: ['human'],
          peers: ['A'],
          timeline: [
            { at: 2, op: 'pause' },
            { at: 4, op: 'resume' },
          ],
          inputs: 'scripted:always',
          expect: { converge: true, liveReference: true },
        })
      )
    ).resolves.toMatchObject({ ticks: 6 });
  });
});

describe('fuzz connection order', () => {
  it('never reconnects before its disconnect', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = prng(seed);
      for (let index = 0; index < 20; index += 1) {
        assertConnectionOrder(generateScenario(rng, seed, index).timeline);
      }
    }
  });
});

describe('inject miss predicate', () => {
  it('keeps convergence and a foreign exception apart from divergence', async () => {
    const driver = createV65Driver();
    const quiet = scenario('quiet', {
      suite: 'fuzz',
      tags: ['fuzz'],
      seed: 1,
      ticks: 4,
      slots: ['human'],
      peers: ['A'],
      timeline: [],
      inputs: 'bots',
      expect: { converge: true },
    });
    const injected = injectScenario(11);
    const missed = scenario('gate-miss', {
      suite: 'fuzz',
      tags: ['fuzz'],
      seed: 3,
      ticks: 6,
      slots: ['human'],
      peers: ['A', 'B'],
      timeline: [
        {
          op: 'faults',
          from: 1,
          to: 4,
          peer: 'B',
          delay: [2, 2],
          dup: 0,
          reorder: 0,
          drop: 0,
        },
      ],
      inputs: 'scripted:always',
      expect: { faultEffect: true },
      options: { disableFaultGate: true },
    });
    await expect(
      injectMissPersists(driver, quiet, 'converged', 'expected divergence')
    ).resolves.toBe(true);
    await expect(
      injectMissPersists(driver, injected, 'converged', 'expected divergence')
    ).resolves.toBe(false);
    await expect(
      injectMissPersists(driver, missed, 'threw', 'fault gate had no effect')
    ).resolves.toBe(true);
    await expect(
      injectMissPersists(driver, missed, 'threw', 'formatVersion is newer')
    ).resolves.toBe(false);
    await expect(
      injectMissPersists(driver, quiet, 'threw', 'fault gate had no effect')
    ).resolves.toBe(false);
    await expect(
      injectMissPersists(driver, injected, 'threw', 'fault gate had no effect')
    ).resolves.toBe(false);
  });
});

describe('runner report', () => {
  it('records a failure when the loaded file is missing', async () => {
    const out = mkdtempSync(join(tmpdir(), 'phalanx-it-'));
    await expect(
      runAll(options({ out, load: join(out, 'missing.json') }))
    ).rejects.toThrow(/ENOENT|no such file/);
    const report = JSON.parse(
      readFileSync(join(out, 'report.json'), 'utf8')
    ) as {
      cases: { name: string; status: string; note: string }[];
    };
    const row = report.cases.find((item) => item.name === 'runner');
    expect(row?.status).toBe('fail');
    expect(row?.note).toMatch(/ENOENT|no such file/);
  });

  it('runs a loaded scenario with the requested seed', async () => {
    const out = mkdtempSync(join(tmpdir(), 'phalanx-it-'));
    const file = join(out, 'seeded.json');
    writeFileSync(
      file,
      `${JSON.stringify(
        scenario('seeded', {
          suite: 'adversarial',
          tags: ['adversarial'],
          seed: 21,
          ticks: 2,
          slots: ['human'],
          peers: ['A'],
          timeline: [],
          inputs: 'bots',
          expect: { converge: true },
        })
      )}\n`
    );
    const report = await runAll(options({ out, load: file, seed: 123 }));
    expect(report.header.seeds).toEqual([123]);
    expect(report.cases[0]).toMatchObject({
      name: 'seeded',
      seed: 123,
      status: 'pass',
    });
  });
});

function named(name: string): Scenario {
  const found = catalog().find((item) => item.name === name);
  if (found === undefined) throw new Error(`missing scenario ${name}`);
  return found;
}

function options(
  over: Partial<RunOptions> & Pick<RunOptions, 'out'>
): RunOptions {
  return {
    profile: 'quick',
    tags: [],
    updateBaseline: false,
    pr: '66',
    ...over,
  };
}

function recordingDriver(inner: SimDriver, delivered: number[]): SimDriver {
  return {
    name: inner.name,
    capabilities: inner.capabilities,
    openReplay: (replay) => inner.openReplay(replay),
    incompatibleSnapshot: (bytes) => inner.incompatibleSnapshot(bytes),
    swapSchemaFields: (bytes) => inner.swapSchemaFields(bytes),
    changeSchemaFieldType: (bytes) => inner.changeSchemaFieldType(bytes),
    createMatch(spec) {
      const match = inner.createMatch(spec);
      return {
        log: () => match.log(),
        armInject: (tick: number) => {
          match.armInject(tick);
        },
        dispose: () => {
          match.dispose();
        },
        createPeer(id, opts) {
          const peer = match.createPeer(id, opts);
          return {
            ...peer,
            deliver(entry: LogEntry): void {
              if (id === 'B') delivered.push(entry.tick);
              peer.deliver(entry);
            },
          };
        },
      };
    },
  };
}

function assertConnectionOrder(timeline: readonly TimelineEvent[]): void {
  let open: number | null = null;
  const ordered = [...timeline].sort(
    (left, right) => eventAt(left) - eventAt(right)
  );
  for (const event of ordered) {
    if (event.op === 'disconnect') {
      expect(open).toBeNull();
      open = event.at;
    } else if (event.op === 'reconnect') {
      expect(open).not.toBeNull();
      expect(event.at).toBeGreaterThan(open ?? -1);
      if (event.via === 'snapshot') expect(event.at).toBeGreaterThan(0);
      open = null;
    }
  }
}

function eventAt(event: TimelineEvent): number {
  if ('at' in event) return event.at;
  if (event.op === 'faults') return event.from;
  return 0;
}
