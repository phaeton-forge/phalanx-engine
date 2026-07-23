import dotenv from 'dotenv';
import { exec } from 'child_process';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config({ path: '.env.production.local' });
dotenv.config({ path: '.env.production' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const bucketName = process.env.BUCKET_NAME;
const region = 'ru-central1';
const endpoint = 'https://storage.yandexcloud.net';
const accessKeyId = process.env.YC_DEPLOYMENT_KEY;
const secretAccessKey = process.env.YC_DEPLOYMENT_SECRET;

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
};

if (!bucketName || !accessKeyId || !secretAccessKey) {
  console.error(
    'Error: Missing required environment variables. Please check your .env.production.local file.',
  );
  process.exit(1);
}

console.log('Building abilities-playground (workspace deps + client)...');
console.log(`VITE_SERVER_URL=${process.env.VITE_SERVER_URL ?? '(not set)'}`);

const buildProcess = exec('pnpm --filter abilities-playground... build', {
  cwd: repoRoot,
  shell: true,
  env: { ...process.env },
});

buildProcess.stdout.pipe(process.stdout);
buildProcess.stderr.pipe(process.stderr);

buildProcess.on('close', (code) => {
  if (code !== 0) {
    console.error('Build failed!');
    process.exit(1);
  }
  console.log('Build successful. Starting deployment...');
  uploadDirectory(path.join(__dirname, 'dist'));
});

const s3Client = new S3Client({
  region,
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

async function uploadDirectory(absoluteDirPath) {
  function getFiles(dir) {
    const dirents = fs.readdirSync(dir, { withFileTypes: true });
    const files = dirents.map((dirent) => {
      const res = path.resolve(dir, dirent.name);
      return dirent.isDirectory() ? getFiles(res) : res;
    });
    return Array.prototype.concat(...files);
  }

  const filesToUpload = getFiles(absoluteDirPath);
  console.log(`Found ${filesToUpload.length} files to upload.`);

  try {
    await Promise.all(
      filesToUpload.map(async (filePath) => {
        const fileStream = fs.createReadStream(filePath);
        const key = path.relative(absoluteDirPath, filePath).replace(/\\/g, '/');
        const contentType =
          mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

        const uploader = new Upload({
          client: s3Client,
          params: {
            Bucket: bucketName,
            Key: key,
            Body: fileStream,
            ContentType: contentType,
          },
        });

        await uploader.done();
        console.log(`Uploaded: ${key} (Content-Type: ${contentType})`);
      }),
    );
    console.log('Deployment successful!');
  } catch (err) {
    console.error('Deployment failed:', err);
    process.exit(1);
  }
}
