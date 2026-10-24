import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGE_DIRS = [
  'phalanx-math',
  'phalanx-protocol',
  'phalanx-ecs',
  'phalanx-physics',
  'phalanx-abilities',
  'phalanx-runtime',
  'phalanx-game',
  'phalanx-client',
  'phalanx-server',
];

const BUMP_TYPES = new Set(['patch', 'minor', 'major']);

function parseArgs() {
  const arg = process.argv[2] ?? 'patch';
  if (arg === '--check') {
    return 'check';
  }
  if (!BUMP_TYPES.has(arg)) {
    console.error(
      `Invalid bump type "${arg}". Use patch, minor, major, or --check.`
    );
    process.exit(1);
  }
  return arg;
}

function bumpSemver(version, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  switch (type) {
    case 'major':
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor += 1;
      patch = 0;
      break;
    case 'patch':
      patch += 1;
      break;
  }

  return `${major}.${minor}.${patch}`;
}

function readPackageJson(dir) {
  const path = join(rootDir, dir, 'package.json');
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return { path, json };
}

function assertVersionsInSync(packages) {
  const currentVersion = packages[0].json.version;
  const inSync = packages.every((pkg) => pkg.json.version === currentVersion);
  if (inSync) {
    return currentVersion;
  }

  console.error('package versions are out of sync:');
  for (const pkg of packages) {
    console.error(`${pkg.json.name}: ${pkg.json.version}`);
  }
  process.exit(1);
}

function assertNotPrivate(packages) {
  const privatePackages = packages.filter((pkg) => pkg.json.private === true);
  if (privatePackages.length === 0) {
    return;
  }

  for (const pkg of privatePackages) {
    console.error(`${pkg.json.name}: package must not be private`);
  }
  process.exit(1);
}

const mode = parseArgs();
const packages = PACKAGE_DIRS.map((dir) => ({ dir, ...readPackageJson(dir) }));
const currentVersion = assertVersionsInSync(packages);

if (mode === 'check') {
  assertNotPrivate(packages);
  console.log(`@phalanx-engine packages are in sync at ${currentVersion}`);
} else {
  const nextVersion = bumpSemver(currentVersion, mode);

  for (const pkg of packages) {
    pkg.json.version = nextVersion;
    writeFileSync(pkg.path, `${JSON.stringify(pkg.json, null, 2)}\n`, 'utf8');
  }

  console.log(
    `Bumped @phalanx-engine packages (${mode}): ${currentVersion} → ${nextVersion}`
  );
  for (const dir of PACKAGE_DIRS) {
    console.log(`  ${dir}/package.json`);
  }
}
