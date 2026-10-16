import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { dirname } from 'node:path';
import type { SimDriver } from '../driver/SimDriver.js';
import type { PerfRow } from '../report/types.js';
import { parseJson } from '../util/json.js';
import { demoSpec } from './spec.js';

interface Sample {
  readonly metric: string;
  readonly current: number;
  readonly higherIsBetter: boolean;
}

interface BaselineFile {
  readonly metrics: Readonly<Record<string, number>>;
}

export function measurePerf(
  driver: SimDriver,
  counts: readonly number[]
): Sample[] {
  const samples: Sample[] = [];
  for (const count of counts) samples.push(...measureCount(driver, count));
  return samples;
}

export function judgePerf(
  samples: readonly Sample[],
  baseline: BaselineFile,
  update: boolean
): {
  readonly rows: PerfRow[];
  readonly status: 'pass' | 'warn' | 'fail';
  readonly note: string;
} {
  const rows: PerfRow[] = [];
  let status: 'pass' | 'warn' | 'fail' = 'pass';
  for (const sample of samples) {
    const previous = baseline.metrics[sample.metric];
    const row = compare(sample, previous);
    rows.push(row);
    if (update || previous === undefined) continue;
    const next = worseStatus(sample, previous);
    if (next === 'fail') status = 'fail';
    else if (next === 'warn' && status !== 'fail') status = 'warn';
  }
  const note = update
    ? 'baseline updated'
    : status === 'pass'
      ? ''
      : status === 'warn'
        ? 'perf moved more than 10%'
        : 'perf moved more than 25%';
  return { rows, status: update ? 'pass' : status, note };
}

export function readBaseline(path: string): BaselineFile {
  try {
    const value = parseJson(readFileSync(path, 'utf8'));
    if (typeof value !== 'object' || value === null || !('metrics' in value)) {
      return { metrics: {} };
    }
    const metrics = value.metrics;
    if (
      typeof metrics !== 'object' ||
      metrics === null ||
      Array.isArray(metrics)
    ) {
      return { metrics: {} };
    }
    const out: Record<string, number> = {};
    const record = metrics as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const metric = record[key];
      if (typeof metric === 'number' && Number.isFinite(metric))
        out[key] = metric;
    }
    return { metrics: out };
  } catch {
    return { metrics: {} };
  }
}

export function writeBaseline(path: string, samples: readonly Sample[]): void {
  const metrics: Record<string, number> = {};
  for (const sample of samples) metrics[sample.metric] = sample.current;
  mkdirSync(dirname(path), { recursive: true });
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(metrics).sort()) {
    const value = metrics[key];
    if (value !== undefined) sorted[key] = value;
  }
  writeFileSync(
    path,
    `${JSON.stringify({ metrics: sorted }, null, 2)}\n`,
    'utf8'
  );
}

function measureCount(driver: SimDriver, count: number): Sample[] {
  const passes: Sample[][] = [];
  for (let pass = 0; pass < 3; pass += 1)
    passes.push(measureOnce(driver, count));
  const width = passes[0]?.length ?? 0;
  const merged: Sample[] = [];
  for (let index = 0; index < width; index += 1) {
    const column = passes
      .map((pass) => pass[index])
      .filter((item): item is Sample => item !== undefined);
    const mid = column[Math.floor(column.length / 2)];
    if (mid === undefined) continue;
    const values = column
      .map((item) => item.current)
      .sort((left, right) => left - right);
    merged.push(
      sample(
        mid.metric,
        values[Math.floor(values.length / 2)] ?? mid.current,
        mid.higherIsBetter
      )
    );
  }
  return merged;
}

function measureOnce(driver: SimDriver, count: number): Sample[] {
  const match = driver.createMatch(demoSpec(1, count));
  try {
    const peer = match.createPeer('A', { role: 'authority' });
    for (let tick = 0; tick < 4; tick += 1) peer.step(1);
    const heapBefore = process.memoryUsage().heapUsed;
    const times: number[] = [];
    for (let tick = 0; tick < 24; tick += 1) {
      const started = performance.now();
      peer.step(1);
      times.push(performance.now() - started);
    }
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    const saveStarted = performance.now();
    const bytes = peer.snapshot();
    const saveMs = performance.now() - saveStarted;
    const twin = match.createPeer('restore', { role: 'replica' });
    const restoreStarted = performance.now();
    twin.restore(bytes);
    const restoreMs = performance.now() - restoreStarted;
    twin.dispose();
    const sum = times.reduce((total, time) => total + time, 0);
    const sorted = [...times].sort((left, right) => left - right);
    const label = String(count);
    return [
      sample(`ticksPerSec.${label}`, times.length / (sum / 1000), true),
      sample(`p50TickMs.${label}`, percentile(sorted, 0.5), false),
      sample(`p99TickMs.${label}`, percentile(sorted, 0.99), false),
      sample(`saveMs.${label}`, saveMs, false),
      sample(`restoreMs.${label}`, restoreMs, false),
      sample(`snapshotBytes.${label}`, bytes.byteLength, false),
      sample(`heapDeltaBytes.${label}`, heapDelta, false),
    ];
  } finally {
    match.dispose();
  }
}

function sample(
  metric: string,
  current: number,
  higherIsBetter: boolean
): Sample {
  return {
    metric,
    current: Math.round(current * 1000) / 1000,
    higherIsBetter,
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1)
  );
  return sorted[index] ?? 0;
}

function compare(sample: Sample, baseline: number | undefined): PerfRow {
  if (baseline === undefined) {
    return {
      metric: sample.metric,
      baseline: null,
      current: sample.current,
      deltaPct: null,
      worse: false,
    };
  }
  if (baseline === 0) {
    return {
      metric: sample.metric,
      baseline,
      current: sample.current,
      deltaPct: null,
      worse: false,
    };
  }
  const deltaPct = ((sample.current - baseline) / Math.abs(baseline)) * 100;
  return {
    metric: sample.metric,
    baseline,
    current: sample.current,
    deltaPct: Math.round(deltaPct * 10) / 10,
    worse: sample.higherIsBetter
      ? sample.current < baseline
      : sample.current > baseline,
  };
}

function worseStatus(
  sample: Sample,
  baseline: number
): 'pass' | 'warn' | 'fail' {
  if (sample.higherIsBetter) {
    if (baseline === 0) return 'pass';
    const ratio = sample.current / baseline;
    if (ratio < 0.75) return 'fail';
    if (ratio < 0.9) return 'warn';
    return 'pass';
  }
  // A non-positive sample (heap freed by GC) has no stable percentage.
  if (baseline <= 0) return 'pass';
  const ratio = sample.current / baseline;
  if (ratio > 1.25) return 'fail';
  if (ratio > 1.1) return 'warn';
  return 'pass';
}
