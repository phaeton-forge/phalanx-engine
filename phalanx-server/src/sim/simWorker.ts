import { parentPort } from 'node:worker_threads';
import { postSimOut } from './postTransfer.js';
import { SimProcess } from './simCore.js';
import type { SimIn } from './messages.js';

/**
 * One shared simulation thread. `process.exit` inside a match throws
 * `SimCrashError` so that match ends and the thread keeps the others.
 * Shutdown calls the real exit after the queue drains. The worker fatal
 * handler also calls `process.exit()` with no code; that path must exit
 * for real and print the original error, not `process.exit(0)`.
 */
const realExit = process.exit.bind(process);
let closing = false;
let fatalCause: unknown;

process.on('uncaughtExceptionMonitor', (error: unknown) => {
  fatalCause = error;
});

process.exit = (code?: number): never => {
  if (closing) realExit(code);
  if (runtimeIsExiting()) {
    if (fatalCause !== undefined) console.error(fatalCause);
    realExit(runtimeStatus(code));
  }
  const error = new Error(`process.exit(${String(code ?? 0)})`);
  error.name = 'SimCrashError';
  throw error;
};

/** Set by Node before the worker fatal handler calls `process.exit()`. */
function runtimeIsExiting(): boolean {
  return (process as { _exiting?: boolean })._exiting === true;
}

function runtimeStatus(code: number | undefined): number {
  if (typeof code === 'number') return code;
  if (typeof process.exitCode === 'number') return process.exitCode;
  return 1;
}

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
  if (message.t === 'close') closing = true;
  sim.push(message);
  if (message.t === 'close') {
    void sim.whenIdle().then(() => {
      closing = true;
      realExit(0);
    });
  }
});
