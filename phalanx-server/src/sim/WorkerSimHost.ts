import { existsSync } from 'node:fs';
import { Worker, type ResourceLimits } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { SimIn, SimOut } from './messages.js';
import type { SimHost } from './SimHost.js';

let spawned = 0;

/** How many worker threads this process has constructed. */
export function simWorkersSpawned(): number {
  return spawned;
}

export function resolveSimWorkerPath(): string {
  const beside = fileURLToPath(new URL('./simWorker.js', import.meta.url));
  if (existsSync(beside)) return beside;
  return fileURLToPath(new URL('../../dist/sim/simWorker.js', import.meta.url));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

function isOom(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ERR_WORKER_OUT_OF_MEMORY';
}

/**
 * One worker for every server match in this process. A thrown tick or an
 * overridden `process.exit` ends that match. A dead thread ends every
 * match it was hosting. Relay rooms are not on this thread.
 */
export class WorkerSimHost implements SimHost {
  public readonly mode = 'worker' as const;
  private readonly worker: Worker;
  private readonly handlers = new Set<(message: SimOut) => void>();
  private readonly matches = new Set<string>();
  private closed = false;
  private fatal: { kind: 'sim-crash' | 'sim-oom'; message: string } | null =
    null;
  private exited = false;
  private exitWait: Promise<void> | null = null;

  public constructor(resourceLimits?: ResourceLimits) {
    const entry = resolveSimWorkerPath();
    if (!existsSync(entry)) {
      throw new Error(`sim worker entry not found: ${entry}`);
    }
    spawned += 1;
    this.worker = new Worker(entry, {
      execArgv: [],
      env: { ...process.env, PHALANX_SIM_WORKER: '1' },
      ...(resourceLimits !== undefined ? { resourceLimits } : {}),
    });
    this.worker.on('message', (message: SimOut) => {
      this.note(message);
      for (const handler of this.handlers) handler(message);
    });
    this.worker.on('error', (error) => {
      if (this.closed) return;
      const kind = isOom(error) ? 'sim-oom' : 'sim-crash';
      this.markFatal(kind, error.message);
    });
    this.worker.on('exit', (code) => {
      this.exited = true;
      if (this.closed || this.fatal !== null) return;
      this.markFatal('sim-crash', `worker exited (${String(code)})`);
    });
  }

  public post(message: SimIn): void {
    if (this.closed) return;
    if (message.t === 'open') this.matches.add(message.matchId);
    if (message.t === 'end') this.matches.delete(message.matchId);
    if (message.t === 'close') this.matches.clear();
    if (this.fatal !== null) {
      if (message.t === 'open') this.matches.delete(message.matchId);
      if (message.t === 'end') this.queueEnded(message.matchId);
      return;
    }
    try {
      this.worker.postMessage(message);
    } catch (error) {
      const kind = isOom(error) ? 'sim-oom' : 'sim-crash';
      const text = errorText(error);
      this.markFatal(kind, text.length > 0 ? text : 'worker post failed');
      if (message.t === 'end') this.queueEnded(message.matchId);
    }
  }

  public subscribe(handler: (message: SimOut) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  public activeMatches(): number {
    return this.matches.size;
  }

  public healthy(): boolean {
    return !this.closed && this.fatal === null && !this.exited;
  }

  public close(): Promise<void> {
    if (this.exitWait !== null) return this.exitWait;
    this.closed = true;
    if (this.exited) {
      this.exitWait = Promise.resolve();
      return this.exitWait;
    }
    this.exitWait = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.worker.removeAllListeners();
        void this.worker.terminate().then(() => resolve());
      }, 2000);
      this.worker.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        this.worker.postMessage({ t: 'close' } satisfies SimIn);
      } catch {
        clearTimeout(timer);
        this.worker.removeAllListeners();
        void this.worker.terminate().then(() => resolve());
      }
    });
    return this.exitWait;
  }

  private note(message: SimOut): void {
    if (
      message.t === 'sim-error' ||
      message.t === 'sim-crash' ||
      message.t === 'sim-oom' ||
      message.t === 'ended'
    ) {
      this.matches.delete(message.matchId);
    }
  }

  /** `end` after the thread is already dead still resolves the caller. */
  private queueEnded(matchId: string): void {
    this.matches.delete(matchId);
    queueMicrotask(() => {
      const ended: SimOut = { t: 'ended', matchId };
      for (const handler of this.handlers) handler(ended);
    });
  }

  private markFatal(kind: 'sim-crash' | 'sim-oom', message: string): void {
    if (this.fatal !== null) return;
    this.fatal = { kind, message };
    this.failAll(kind, message);
  }

  private failAll(kind: 'sim-crash' | 'sim-oom', message: string): void {
    const ids = [...this.matches];
    this.matches.clear();
    for (const matchId of ids) {
      const fault: SimOut = { t: kind, matchId, message };
      for (const handler of this.handlers) handler(fault);
    }
  }
}
