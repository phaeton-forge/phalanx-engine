import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TIMEOUT_MS = 60_000;
const PACKAGES = [
  '@phalanx-engine/protocol',
  '@phalanx-engine/client',
  '@phalanx-engine/server',
];
const ALLOWED = ['client', 'protocol', 'server'];
const started = Date.now();

const MATCH = `import { Phalanx } from '@phalanx-engine/server';
import { PhalanxClient } from '@phalanx-engine/client';

const server = new Phalanx({
  port: 0,
  gameMode: '1v1',
  countdownSeconds: 1,
  tickRate: 20,
  matchmakingIntervalMs: 100,
  cors: { origin: '*' },
});
await server.start();
const url = 'http://127.0.0.1:' + String(server.getPort());

function track(playerId) {
  const client = new PhalanxClient({
    serverUrl: url,
    playerId,
    username: playerId,
  });
  const batches = new Map();
  client.on('commands', (batch) => {
    batches.set(batch.tick, batch);
  });
  client.onFrame(() => {});
  client.on('tick', (event) => {
    if (event.tick <= 20) {
      client.sendCommand('move', { by: playerId, n: event.tick });
    }
  });
  return { client, batches };
}

const alpha = track('player-a');
const beta = track('player-b');
await alpha.client.connect();
await beta.client.connect();
const startA = alpha.client.waitForGameStart();
const startB = beta.client.waitForGameStart();
await alpha.client.joinQueue();
await beta.client.joinQueue();
const gameA = await startA;
const gameB = await startB;
if (gameA.matchId !== gameB.matchId) {
  throw new Error('matchId mismatch');
}
if (
  alpha.client.randomSeed === null ||
  alpha.client.randomSeed !== beta.client.randomSeed
) {
  throw new Error('randomSeed mismatch');
}
alpha.client.sendReady();
beta.client.sendReady();

const deadline = Date.now() + 20000;
while (Date.now() < deadline) {
  if (alpha.batches.has(20) && beta.batches.has(20)) break;
  await new Promise((resolve) => setTimeout(resolve, 25));
}

for (let tick = 1; tick <= 20; tick += 1) {
  const left = alpha.batches.get(tick);
  const right = beta.batches.get(tick);
  if (!left || !right) throw new Error('missing tick ' + String(tick));
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error('batch mismatch at tick ' + String(tick));
  }
  const players = new Set(left.commands.map((command) => command.playerId));
  if (!players.has('player-a') || !players.has('player-b')) {
    throw new Error(
      'tick ' + String(tick) + ' players ' + [...players].join(',')
    );
  }
}

alpha.client.disconnect();
beta.client.disconnect();
await server.stop();
`;

function remaining() {
  return TIMEOUT_MS - (Date.now() - started);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const budget = remaining();
    if (budget <= 0) {
      reject(new Error('smoke-lands: timeout'));
      return;
    }
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`smoke-lands: timeout during ${command}`));
    }, budget);
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else {
        reject(
          new Error(
            `${command} ${args.join(' ')} failed (${String(code)})\n${stderr || stdout}`
          )
        );
      }
    });
  });
}

function readPackage(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`smoke-lands: ${path} is not an object`);
  }
  return value;
}

function newestTarball(directory) {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.tgz'))
    .sort();
  const name = names[names.length - 1];
  if (name === undefined)
    throw new Error(`smoke-lands: no tarball in ${directory}`);
  return join(directory, name);
}

function safe(name) {
  return name.replace('@', '').replace('/', '-');
}

const root = mkdtempSync(join(tmpdir(), 'phalanx-lands-'));
let exitCode = 0;
try {
  if (remaining() <= 0) throw new Error('smoke-lands: timeout');
  const extracted = new Map();
  for (const name of PACKAGES) {
    const packed = join(root, 'packed', safe(name));
    const dir = join(root, 'src', safe(name));
    mkdirSync(packed, { recursive: true });
    mkdirSync(dir, { recursive: true });
    await run(
      'pnpm',
      ['--filter', name, 'pack', '--pack-destination', packed],
      process.cwd()
    );
    await run('tar', ['-xzf', newestTarball(packed), '-C', dir], root);
    extracted.set(name, join(dir, 'package'));
  }

  const finalDir = join(root, 'final');
  mkdirSync(finalDir, { recursive: true });
  const tarballs = new Map();
  for (const name of PACKAGES) {
    const dir = extracted.get(name);
    if (dir === undefined) throw new Error(`missing extract ${name}`);
    const pkg = readPackage(join(dir, 'package.json'));
    if (typeof pkg.version !== 'string') throw new Error(`${name}: no version`);
    tarballs.set(name, join(finalDir, `${safe(name)}-${pkg.version}.tgz`));
  }
  for (const name of PACKAGES) {
    const dir = extracted.get(name);
    if (dir === undefined) continue;
    const pkgPath = join(dir, 'package.json');
    const pkg = readPackage(pkgPath);
    for (const field of [
      'dependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const deps = pkg[field];
      if (typeof deps !== 'object' || deps === null || Array.isArray(deps))
        continue;
      for (const key of Object.keys(deps)) {
        const tarball = tarballs.get(key);
        if (tarball !== undefined) deps[key] = `file:${tarball}`;
      }
    }
    delete pkg.scripts;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    await run('npm', ['pack', '--pack-destination', finalDir], dir);
  }

  const app = join(root, 'app');
  mkdirSync(app, { recursive: true });
  await run('npm', ['init', '-y'], app);
  const appPkgPath = join(app, 'package.json');
  const appPkg = readPackage(appPkgPath);
  appPkg.type = 'module';
  writeFileSync(appPkgPath, `${JSON.stringify(appPkg, null, 2)}\n`);
  const installs = PACKAGES.map((name) => {
    const tarball = tarballs.get(name);
    if (tarball === undefined) throw new Error(`missing tarball ${name}`);
    return tarball;
  });
  await run('npm', ['install', ...installs], app);

  const installed = readdirSync(
    join(app, 'node_modules', '@phalanx-engine')
  ).sort();
  const extra = [];
  if (installed.join() !== ALLOWED.join()) {
    extra.push(...installed.filter((name) => !ALLOWED.includes(name)));
    for (const name of ALLOWED) {
      if (!installed.includes(name)) extra.push(`missing:${name}`);
    }
  }
  for (const banned of ['@hastom/fixed-point', 'pure-rand']) {
    const scope = banned.startsWith('@');
    const parts = scope ? banned.split('/') : [banned];
    const present = scope
      ? existsDir(join(app, 'node_modules', parts[0], parts[1]))
      : existsDir(join(app, 'node_modules', banned));
    if (present) extra.push(banned);
  }
  if (extra.length > 0 || installed.join() !== ALLOWED.join()) {
    throw new Error(
      `smoke-lands: node_modules/@phalanx-engine is ${installed.join(',')} extra ${extra.join(',')}`
    );
  }

  writeFileSync(join(app, 'match.mjs'), MATCH);
  await run(process.execPath, ['match.mjs'], app);
  if (remaining() <= 0) throw new Error('smoke-lands: timeout');
  console.log('smoke-lands: ok (whitelist, 2 clients, 20 ticks)');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);

function existsDir(path) {
  try {
    return readdirSync(path).length >= 0;
  } catch {
    return false;
  }
}
