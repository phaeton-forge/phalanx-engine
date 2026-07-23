import dotenv from 'dotenv';
import archiver from 'archiver';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config({ path: '.env.production.local' });
dotenv.config({ path: '.env.production' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const validTargets = ['web', 'zip'];

function parseTargets() {
  const argv = process.argv.slice(2);
  let targets = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--targets' && i + 1 < argv.length) {
      targets = argv[i + 1];
      i++;
    } else if (argv[i].startsWith('--targets=')) {
      targets = argv[i].slice('--targets='.length);
    }
  }
  const list = (targets ?? 'web,zip')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const invalid = list.filter((t) => !validTargets.includes(t));
  if (invalid.length) {
    console.error(
      `Error: Unknown target(s): ${invalid.join(', ')}. Valid targets: ${validTargets.join(', ')}.`,
    );
    process.exit(1);
  }
  if (!list.length) {
    console.error('Error: No targets selected.');
    process.exit(1);
  }
  return list;
}

function run(cmd, args, cwd = __dirname) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd, shell: true, env: process.env });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function zipDist(sourceDir, outFile) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    const output = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function main() {
  const targets = parseTargets();
  const distDir = path.join(__dirname, 'dist');
  const zipOut = path.join(__dirname, 'dist-zip', 'abilities-playground.zip');

  console.log(`Release targets: ${targets.join(', ')}`);
  console.log(`VITE_SERVER_URL=${process.env.VITE_SERVER_URL ?? '(not set)'}`);

  if (targets.includes('web')) {
    console.log('\n=== [web] Building + uploading to Yandex Cloud bucket ===');
    await run('node', ['yc_bucket_deploy.mjs']);
  } else {
    console.log('\n=== Building project ===');
    await run('pnpm', ['--filter', 'abilities-playground...', 'build'], repoRoot);
  }

  if (!fs.existsSync(distDir)) {
    console.error('Error: dist/ not found after build.');
    process.exit(1);
  }

  if (targets.includes('zip')) {
    console.log('\n=== [zip] Packaging dist/ into abilities-playground.zip ===');
    const bytes = await zipDist(distDir, zipOut);
    console.log(`Created ${path.relative(__dirname, zipOut)} (${(bytes / 1024).toFixed(1)} KB)`);
  }

  console.log('\n=== Release summary ===');
  if (targets.includes('web')) {
    const bucket = process.env.BUCKET_NAME;
    console.log(`web: uploaded to ${bucket ? `https://${bucket}` : '(BUCKET_NAME not set)'}`);
  }
  if (targets.includes('zip')) {
    console.log(`zip: ${path.relative(__dirname, zipOut)}`);
    console.log('  Upload manually to the Yandex Games console (https://games.yandex.ru).');
  }
  console.log('');
}

main().catch((err) => {
  console.error('Release failed:', err.message);
  process.exit(1);
});
