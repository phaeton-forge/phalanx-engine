import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { MatchSpec } from '../driver/SimDriver.js';
import { PACKAGE_ROOT } from '../paths.js';
import { demoSpec } from './spec.js';

export async function runDetContinuous(ticks: number): Promise<{
  readonly ticks: number;
  readonly peers: number;
  readonly processes: number;
}> {
  const spec = demoSpec(99);
  const [left, right] = await Promise.all([
    runWorker(spec, ticks),
    runWorker(spec, ticks),
  ]);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      throw new Error(
        `det-continuous diverged at step ${String(index)}: ${left[index] ?? '<missing>'} vs ${right[index] ?? '<missing>'}`
      );
    }
  }
  return { ticks: left.length, peers: 2, processes: 2 };
}

function runWorker(spec: MatchSpec, ticks: number): Promise<readonly string[]> {
  const worker = join(PACKAGE_ROOT, 'src', 'suites', 'detWorker.ts');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker], {
      cwd: PACKAGE_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err.push(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = Buffer.concat(out).toString('utf8').trim();
      const stderr = Buffer.concat(err).toString('utf8').trim();
      if (code !== 0) {
        reject(
          new Error(stderr || stdout || `det worker exited ${String(code)}`)
        );
        return;
      }
      const parsed: unknown = JSON.parse(stdout) as unknown;
      if (!isDigestPayload(parsed)) {
        reject(new Error('det worker returned no digests'));
        return;
      }
      resolve(parsed.digests);
    });
    child.stdin.write(JSON.stringify({ spec, ticks }));
    child.stdin.end();
  });
}

function isDigestPayload(value: unknown): value is { digests: string[] } {
  if (typeof value !== 'object' || value === null || !('digests' in value)) {
    return false;
  }
  const digests: unknown = value.digests;
  return (
    Array.isArray(digests) && digests.every((item) => typeof item === 'string')
  );
}
