import { parentPort, workerData } from 'node:worker_threads';
import { digestBytes, initDigest } from '../../dist/index.js';

if (parentPort === null) {
  throw new Error('xxh64 worker: missing parent port');
}
if (!(workerData instanceof Uint8Array)) {
  throw new Error('xxh64 worker: expected a Uint8Array');
}
await initDigest();
parentPort.postMessage(digestBytes(workerData));
