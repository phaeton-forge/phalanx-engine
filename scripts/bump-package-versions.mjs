import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGE_DIRS = [
  'phalanx-math',
  'phalanx-ecs',
  'phalanx-server',
  'phalanx-client',
  'phalanx-physics',
  'phalanx-abilities',
];

const BUMP_TYPES = new Set(['patch', 'minor', 'major']);

function parseArgs() {
  const arg = process.argv[2] ?? 'patch';
  if (!BUMP_TYPES.has(arg)) {
    console.error(`Invalid bump type "${arg}". Use patch, minor, or major.`);
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

const bumpType = parseArgs();
const packages = PACKAGE_DIRS.map((dir) => ({ dir, ...readPackageJson(dir) }));
const versions = packages.map((pkg) => pkg.json.version);
const currentVersion = versions[0];

const mismatched = packages.filter((pkg) => pkg.json.version !== currentVersion);
if (mismatched.length > 0) {
  console.warn('Warning: package versions are out of sync:');
  for (const pkg of packages) {
    console.warn(`  ${pkg.json.name}: ${pkg.json.version}`);
  }
  console.warn(`Bumping all packages to the next ${bumpType} from ${currentVersion}.`);
}

const nextVersion = bumpSemver(currentVersion, bumpType);

for (const pkg of packages) {
  pkg.json.version = nextVersion;
  writeFileSync(pkg.path, `${JSON.stringify(pkg.json, null, 2)}\n`, 'utf8');
}

console.log(`Bumped @phalanx-engine packages (${bumpType}): ${currentVersion} → ${nextVersion}`);
for (const dir of PACKAGE_DIRS) {
  console.log(`  ${dir}/package.json`);
}
