import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { REPO_ROOT } from '../paths.js';
import { exec } from '../util/exec.js';
import { parseJson } from '../util/json.js';

const PACKAGES = [
  '@phalanx-engine/math',
  '@phalanx-engine/protocol',
  '@phalanx-engine/ecs',
  '@phalanx-engine/physics',
  '@phalanx-engine/abilities',
  '@phalanx-engine/client',
  '@phalanx-engine/server',
  '@phalanx-engine/runtime',
  '@phalanx-engine/game',
];

const HELLO_JS = `import { FP } from '@phalanx-engine/math';
import { GameWorld } from '@phalanx-engine/ecs';
import { PhysicsWorld } from '@phalanx-engine/physics';
import { defineAttribute } from '@phalanx-engine/abilities';
import { PhalanxClient } from '@phalanx-engine/client';
import { Phalanx } from '@phalanx-engine/server';
import { defineGame } from '@phalanx-engine/runtime';
import { createServerSim } from '@phalanx-engine/game/server';

const value = FP.FromInt(1);
if (value === undefined) process.exit(1);
if (typeof GameWorld !== 'function') process.exit(1);
if (typeof PhysicsWorld !== 'function') process.exit(1);
if (typeof defineAttribute !== 'function') process.exit(1);
if (typeof PhalanxClient !== 'function') process.exit(1);
if (typeof Phalanx !== 'function') process.exit(1);
if (typeof defineGame !== 'function') process.exit(1);
if (typeof createServerSim !== 'function') process.exit(1);
process.stdout.write('ok\\n');
`;

const HELLO_TS = `import { FP } from '@phalanx-engine/math';
import { GameWorld } from '@phalanx-engine/ecs';
import { PhysicsWorld } from '@phalanx-engine/physics';
import { defineAttribute } from '@phalanx-engine/abilities';
import { PhalanxClient } from '@phalanx-engine/client';
import { Phalanx } from '@phalanx-engine/server';
import { defineGame } from '@phalanx-engine/runtime';
import { createServerSim } from '@phalanx-engine/game/server';

export const ready = [
  FP.FromInt(1),
  GameWorld,
  PhysicsWorld,
  defineAttribute,
  PhalanxClient,
  Phalanx,
  defineGame,
  createServerSim,
];
`;

/**
 * Pack every engine package, install the tarballs in a clean project,
 * and run a hello-world under Node and `tsc --noEmit`.
 * `@phalanx-engine/*` deps are rewritten to `file:` tarballs so a
 * missing registry publish cannot hide a broken pack.
 */
export async function runPackageSmoke(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'phalanx-pack-'));
  try {
    const extracted = new Map<string, string>();
    for (const name of PACKAGES) {
      const packed = join(root, 'packed', safe(name));
      const dir = join(root, 'src', safe(name));
      mkdirSync(packed, { recursive: true });
      mkdirSync(dir, { recursive: true });
      await exec(
        'pnpm',
        ['--filter', name, 'pack', '--pack-destination', packed],
        REPO_ROOT
      );
      const tarball = newestTarball(packed);
      await exec('tar', ['-xzf', tarball, '-C', dir], root);
      extracted.set(name, join(dir, 'package'));
    }
    const finalDir = join(root, 'final');
    mkdirSync(finalDir, { recursive: true });
    const tarballs = new Map<string, string>();
    for (const name of PACKAGES) {
      const dir = extracted.get(name);
      if (dir === undefined) throw new Error(`missing extract ${name}`);
      const pkgPath = join(dir, 'package.json');
      const pkg = readPackage(pkgPath);
      const version = pkg['version'];
      if (typeof version !== 'string') throw new Error(`${name}: no version`);
      tarballs.set(name, join(finalDir, `${safe(name)}-${version}.tgz`));
    }
    for (const name of PACKAGES) {
      const dir = extracted.get(name);
      if (dir === undefined) continue;
      const pkgPath = join(dir, 'package.json');
      const pkg = readPackage(pkgPath);
      rewriteDeps(pkg, tarballs);
      delete pkg['scripts'];
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      await exec('npm', ['pack', '--pack-destination', finalDir], dir);
    }
    const app = join(root, 'app');
    mkdirSync(app, { recursive: true });
    const dependencies: Record<string, string> = {};
    for (const name of PACKAGES) {
      const tarball = tarballs.get(name);
      if (tarball === undefined) throw new Error(`missing tarball ${name}`);
      dependencies[name] = `file:${tarball}`;
    }
    writeFileSync(
      join(app, 'package.json'),
      `${JSON.stringify({ name: 'phalanx-smoke', private: true, type: 'module', dependencies }, null, 2)}\n`
    );
    writeFileSync(join(app, 'hello.mjs'), HELLO_JS);
    writeFileSync(join(app, 'hello.ts'), HELLO_TS);
    await exec(
      'npm',
      ['install', '--no-fund', '--no-audit', '--legacy-peer-deps'],
      app
    );
    const hello = await exec(process.execPath, ['hello.mjs'], app);
    if (!hello.includes('ok')) throw new Error(`hello-world output: ${hello}`);
    const require = createRequire(import.meta.url);
    const tsc = require.resolve('typescript/bin/tsc');
    await exec(
      process.execPath,
      [
        tsc,
        '--noEmit',
        '--strict',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--target',
        'es2022',
        '--skipLibCheck',
        'hello.ts',
      ],
      app
    );
    await runLandsSmoke();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const LANDS_PACKAGES = [
  '@phalanx-engine/protocol',
  '@phalanx-engine/math',
  '@phalanx-engine/client',
  '@phalanx-engine/server',
];

const LANDS_JS = `import { readdirSync } from 'node:fs';
import { Phalanx } from '@phalanx-engine/server';
import { PhalanxClient } from '@phalanx-engine/client';

const installed = readdirSync('node_modules/@phalanx-engine');
for (const banned of ['runtime', 'ecs', 'game']) {
  if (installed.includes(banned)) {
    throw new Error('lands install pulled ' + banned);
  }
}
const server = new Phalanx({
  port: 0,
  gameTypes: [{ gameType: 'lands', tickRate: 20, tickMode: 'continuous' }],
});
await server.start();
const client = new PhalanxClient({
  serverUrl: 'http://127.0.0.1:' + String(server.getPort()),
  playerId: 'lands',
  username: 'lands',
});
await client.connect();
client.disconnect();
await server.stop();
process.stdout.write('ok\\n');
`;

/** Relay-only install: client + server, no runtime, ecs, or game. */
async function runLandsSmoke(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'phalanx-lands-'));
  try {
    const extracted = new Map<string, string>();
    for (const name of LANDS_PACKAGES) {
      const packed = join(root, 'packed', safe(name));
      const dir = join(root, 'src', safe(name));
      mkdirSync(packed, { recursive: true });
      mkdirSync(dir, { recursive: true });
      await exec(
        'pnpm',
        ['--filter', name, 'pack', '--pack-destination', packed],
        REPO_ROOT
      );
      const tarball = newestTarball(packed);
      await exec('tar', ['-xzf', tarball, '-C', dir], root);
      extracted.set(name, join(dir, 'package'));
    }
    const finalDir = join(root, 'final');
    mkdirSync(finalDir, { recursive: true });
    const tarballs = new Map<string, string>();
    for (const name of LANDS_PACKAGES) {
      const dir = extracted.get(name);
      if (dir === undefined) throw new Error(`missing extract ${name}`);
      const pkg = readPackage(join(dir, 'package.json'));
      const version = pkg['version'];
      if (typeof version !== 'string') throw new Error(`${name}: no version`);
      tarballs.set(name, join(finalDir, `${safe(name)}-${version}.tgz`));
    }
    for (const name of LANDS_PACKAGES) {
      const dir = extracted.get(name);
      if (dir === undefined) continue;
      const pkgPath = join(dir, 'package.json');
      const pkg = readPackage(pkgPath);
      rewriteDeps(pkg, tarballs);
      delete pkg['scripts'];
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      await exec('npm', ['pack', '--pack-destination', finalDir], dir);
    }
    const app = join(root, 'app');
    mkdirSync(app, { recursive: true });
    const dependencies: Record<string, string> = {};
    for (const name of LANDS_PACKAGES) {
      const tarball = tarballs.get(name);
      if (tarball === undefined) throw new Error(`missing tarball ${name}`);
      dependencies[name] = `file:${tarball}`;
    }
    writeFileSync(
      join(app, 'package.json'),
      `${JSON.stringify({ name: 'phalanx-lands', private: true, type: 'module', dependencies }, null, 2)}\n`
    );
    writeFileSync(join(app, 'lands.mjs'), LANDS_JS);
    await exec(
      'npm',
      ['install', '--no-fund', '--no-audit', '--legacy-peer-deps'],
      app
    );
    const installed = readdirSync(join(app, 'node_modules', '@phalanx-engine'));
    for (const banned of ['runtime', 'ecs', 'game']) {
      if (installed.includes(banned)) {
        throw new Error(`lands install pulled @phalanx-engine/${banned}`);
      }
    }
    const output = await exec(process.execPath, ['lands.mjs'], app);
    if (!output.includes('ok')) throw new Error(`lands output: ${output}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function rewriteDeps(
  pkg: Record<string, unknown>,
  tarballs: ReadonlyMap<string, string>
): void {
  for (const field of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const deps = pkg[field];
    if (typeof deps !== 'object' || deps === null || Array.isArray(deps))
      continue;
    const record = deps as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const tarball = tarballs.get(key);
      if (tarball !== undefined) record[key] = `file:${tarball}`;
    }
  }
}

function readPackage(path: string): Record<string, unknown> {
  const value = parseJson(readFileSync(path, 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`package smoke: ${path} is not an object`);
  }
  return value as Record<string, unknown>;
}

function newestTarball(directory: string): string {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.tgz'))
    .sort();
  const name = names[names.length - 1];
  if (name === undefined)
    throw new Error(`package smoke: no tarball in ${directory}`);
  return join(directory, name);
}

function safe(name: string): string {
  return name.replace('@', '').replace('/', '-');
}
