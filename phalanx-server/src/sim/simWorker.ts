import { parentPort } from 'node:worker_threads';
import { postSimOut } from './postTransfer.js';
import { SimProcess } from './simCore.js';
import type { SimIn } from './messages.js';

/**
 * One shared simulation thread. `process.exit` inside a match throws
 * `SimCrashError` so that match ends and the thread keeps the others.
 * Shutdown calls the real exit after the queue drains.
 */
const realExit = process.exit.bind(process);
process.exit = (code?: number): never => {
  const error = new Error(`process.exit(${String(code ?? 0)})`);
  error.name = 'SimCrashError';
  throw error;
};

const port = parentPort;
if (port === null) {
  throw new Error('simWorker requires parentPort');
}

const sim = new SimProcess(
  {
    send(message) {
      postSimOut(port, message);
    },
  },
  { yieldBetween: false }
);

port.on('message', (message: SimIn) => {
  sim.push(message);
  if (message.t === 'close') {
    void sim.whenIdle().then(() => {
      realExit(0);
    });
  }
});
