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
  const installed = await installTarballs(PACKAGES, {
    'hello.mjs': HELLO_JS,
    'hello.ts': HELLO_TS,
  });
  try {
    const hello = await exec(process.execPath, ['hello.mjs'], installed.app);
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
      installed.app
    );
    await runLandsSmoke();
  } finally {
    rmSync(installed.root, { recursive: true, force: true });
  }
}

const LANDS_PACKAGES = [
  '@phalanx-engine/protocol',
  '@phalanx-engine/math',
  '@phalanx-engine/client',
  '@phalanx-engine/server',
];

const LANDS_ALLOWED = ['client', 'math', 'protocol', 'server'];

const LANDS_JS = `import { readdirSync } from 'node:fs';
import { Phalanx } from '@phalanx-engine/server';
import { PhalanxClient } from '@phalanx-engine/client';

const installed = readdirSync('node_modules/@phalanx-engine').sort();
const allowed = ${JSON.stringify(LANDS_ALLOWED)};
if (installed.join() !== allowed.join()) {
  throw new Error('lands install is ' + installed.join(','));
}

function once(emitter, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout ' + event)), 5000);
    emitter.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

const server = new Phalanx({
  port: 0,
  tickRate: 20,
  countdownSeconds: 0,
  matchmakingIntervalMs: 100,
  gameMode: '1v1',
});
await server.start();
const url = 'http://127.0.0.1:' + String(server.getPort());
const host = new PhalanxClient({ serverUrl: url, playerId: 'host', username: 'host' });
const guest = new PhalanxClient({ serverUrl: url, playerId: 'guest', username: 'guest' });
await host.connect();
await guest.connect();
const foundHost = once(host, 'matchFound');
const foundGuest = once(guest, 'matchFound');
const startHost = once(host, 'gameStart');
const startGuest = once(guest, 'gameStart');
await host.joinQueue();
await guest.joinQueue();
await foundHost;
await foundGuest;
await startHost;
await startGuest;
host.sendReady();
guest.sendReady();
await once(host, 'tick');
const seen = [];
guest.on('commands', (batch) => {
  for (const command of batch.commands) seen.push(command.type);
});
await host.submitCommands(host.getCurrentTick() + 1, [
  { type: 'move', data: { x: 1 } },
]);
const deadline = Date.now() + 5000;
while (!seen.includes('move') && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
if (!seen.includes('move')) throw new Error('commands-batch missed the move');
host.disconnect();
guest.disconnect();
await server.stop();
process.stdout.write('ok\\n');
`;

/** Relay-only install: exactly client, math, protocol, and server. */
async function runLandsSmoke(): Promise<void> {
  const installed = await installTarballs(
    LANDS_PACKAGES,
    { 'lands.mjs': LANDS_JS },
    'phalanx-lands'
  );
  try {
    const names = readdirSync(
      join(installed.app, 'node_modules', '@phalanx-engine')
    ).sort();
    if (names.join() !== LANDS_ALLOWED.join()) {
      throw new Error(
        `lands install is ${names.join(',')} (want ${LANDS_ALLOWED.join(',')})`
      );
    }
    const output = await exec(process.execPath, ['lands.mjs'], installed.app);
    if (!output.includes('ok')) throw new Error(`lands output: ${output}`);
  } finally {
    rmSync(installed.root, { recursive: true, force: true });
  }
}

async function installTarballs(
  packages: readonly string[],
  files: Readonly<Record<string, string>>,
  appName = 'phalanx-smoke'
): Promise<{ root: string; app: string }> {
  const root = mkdtempSync(join(tmpdir(), `${appName}-`));
  const extracted = new Map<string, string>();
  for (const name of packages) {
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
  for (const name of packages) {
    const dir = extracted.get(name);
    if (dir === undefined) throw new Error(`missing extract ${name}`);
    const pkg = readPackage(join(dir, 'package.json'));
    const version = pkg['version'];
    if (typeof version !== 'string') throw new Error(`${name}: no version`);
    tarballs.set(name, join(finalDir, `${safe(name)}-${version}.tgz`));
  }
  for (const name of packages) {
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
  for (const name of packages) {
    const tarball = tarballs.get(name);
    if (tarball === undefined) throw new Error(`missing tarball ${name}`);
    dependencies[name] = `file:${tarball}`;
  }
  writeFileSync(
    join(app, 'package.json'),
    `${JSON.stringify({ name: appName, private: true, type: 'module', dependencies }, null, 2)}\n`
  );
  for (const [filename, contents] of Object.entries(files)) {
    writeFileSync(join(app, filename), contents);
  }
  await exec('npm', ['install', '--no-fund', '--no-audit'], app);
  return { root, app };
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
