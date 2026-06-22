import dotenv from 'dotenv';
import { exec } from 'child_process';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Load from .env.production.local for deployment credentials
dotenv.config({ path: '.env.production.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1. Configuration
const bucketName = process.env.BUCKET_NAME;
const region = 'ru-central1';
const endpoint = 'https://storage.yandexcloud.net';
const accessKeyId = process.env.YC_DEPLOYMENT_KEY;
const secretAccessKey = process.env.YC_DEPLOYMENT_SECRET;

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream',
};

if (!bucketName || !accessKeyId || !secretAccessKey) {
    console.error('Error: Missing required environment variables. Please check your .env.production.local file.');
    process.exit(1);
}

// 2. Build the project
console.log('Building project...');
const buildProcess = exec('pnpm build:local');

buildProcess.stdout.pipe(process.stdout);
buildProcess.stderr.pipe(process.stderr);

buildProcess.on('close', (code) => {
    if (code !== 0) {
        console.error('Build failed!');
        process.exit(1);
    }
    console.log('Build successful. Starting deployment...');
    uploadDirectory('dist');
});

// 3. S3 Client and Upload Logic
const s3Client = new S3Client({
    region,
    endpoint,
    credentials: {
        accessKeyId,
        secretAccessKey,
    },
});

async function uploadDirectory(dirPath) {
    const absoluteDirPath = path.join(__dirname, dirPath);

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
        await Promise.all(filesToUpload.map(async (filePath) => {
            const fileStream = fs.createReadStream(filePath);
            const key = path.relative(absoluteDirPath, filePath).replace(/\\/g, '/');
            const contentType = mimeTypes[path.extname(filePath)] || 'application/octet-stream';

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
        }));
        console.log('Deployment successful!');
    } catch (err) {
        console.error('Deployment failed:', err);
        process.exit(1);
    }
}



