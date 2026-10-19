import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';

const root = process.cwd();

function readPackage(dir) {
  return JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
}

function entryFile(dir, value) {
  const target = typeof value === 'string' ? value : value?.import;
  if (typeof target !== 'string' || !target.endsWith('.js')) {
    throw new Error(`${dir}: export is not a javascript file`);
  }
  return join(root, dir, target);
}

function entries() {
  const runtime = readPackage('phalanx-runtime');
  const game = readPackage('phalanx-game');
  const adapters = new Set(Object.keys(runtime.phalanx?.subpaths ?? {}));
  const files = [];
  for (const [key, value] of Object.entries(runtime.exports ?? {})) {
    if (adapters.has(key)) continue;
    files.push(entryFile('phalanx-runtime', value));
  }
  for (const [key, value] of Object.entries(game.exports ?? {})) {
    if (key === './server') continue;
    files.push(entryFile('phalanx-game', value));
  }
  return files;
}

const nodeWarning =
  /Could not resolve ["']node:|Could not resolve ["'](?:fs|path|crypto|worker_threads|perf_hooks)["']/;

let failed = false;
for (const file of entries()) {
  try {
    const result = await esbuild.build({
      entryPoints: [file],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      logLevel: 'silent',
    });
    const warnings = (result.warnings ?? []).filter((warning) =>
      nodeWarning.test(warning.text)
    );
    if (warnings.length > 0) {
      console.error(
        `${file}: ${warnings.map((warning) => warning.text).join('; ')}`
      );
      failed = true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${file}: ${message}`);
    failed = true;
  }
}

if (failed) process.exit(1);
