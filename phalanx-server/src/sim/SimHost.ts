import type { ResourceLimits } from 'node:worker_threads';
import type { AnyGameDefinition } from '@phalanx-engine/runtime';
import { InProcessSimHost } from './InProcessSimHost.js';
import type { SimIn, SimOut } from './messages.js';
import { WorkerSimHost } from './WorkerSimHost.js';

export interface SimHost {
  readonly mode: 'worker' | 'inProcess';
  post(message: SimIn): void;
  subscribe(handler: (message: SimOut) => void): () => void;
  close(): Promise<void>;
  activeMatches(): number;
  /** False after a worker death or `close()`. New rooms must not open. */
  healthy(): boolean;
}

export interface CreateSimHostOptions {
  readonly mode: 'worker' | 'inProcess';
  readonly resourceLimits?: ResourceLimits;
  /** Definitions passed as objects. Only the in-process host can run them. */
  readonly inline: ReadonlyMap<string, AnyGameDefinition>;
}

export function createSimHost(options: CreateSimHostOptions): SimHost {
  if (options.mode === 'inProcess') {
    return new InProcessSimHost(options.inline);
  }
  if (options.inline.size > 0) {
    throw new Error(
      'worker simHost cannot load a GameDefinition object; pass { module, export? }'
    );
  }
  return new WorkerSimHost(options.resourceLimits);
}
