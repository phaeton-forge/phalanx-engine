import type { AnyGameDefinition } from '@phalanx-engine/runtime';
import type { SimIn, SimOut } from './messages.js';
import { SimProcess } from './simCore.js';
import type { SimHost } from './SimHost.js';

/**
 * Same queue as the worker, on the relay thread. Messages yield between
 * turns so the relay can keep stamping, but one tick still runs to
 * completion before the next turn.
 */
export class InProcessSimHost implements SimHost {
  public readonly mode = 'inProcess' as const;
  private readonly process: SimProcess;
  private readonly handlers = new Set<(message: SimOut) => void>();
  private readonly matches = new Set<string>();
  private closed = false;

  public constructor(inline: ReadonlyMap<string, AnyGameDefinition>) {
    this.process = new SimProcess(
      {
        send: (message) => {
          this.emit(this.clone(message));
        },
      },
      { yieldBetween: true }
    );
    for (const definition of inline.values()) {
      // Registered before any open so a definition object never crosses
      // a thread. The worker host does not use this path.
      this.process.install(definition);
    }
  }

  public post(message: SimIn): void {
    if (this.closed) return;
    if (message.t === 'open') this.matches.add(message.matchId);
    if (message.t === 'end') this.matches.delete(message.matchId);
    if (message.t === 'close') this.matches.clear();
    this.process.push(message);
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

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.process.push({ t: 'close' });
    await this.process.whenIdle();
    this.matches.clear();
  }

  private emit(message: SimOut): void {
    if (
      message.t === 'sim-error' ||
      message.t === 'sim-crash' ||
      message.t === 'sim-oom' ||
      message.t === 'ended'
    ) {
      this.matches.delete(message.matchId);
    }
    for (const handler of this.handlers) handler(message);
  }

  private clone(message: SimOut): SimOut {
    if (message.t === 'snapshot') return message;
    return structuredClone(message);
  }
}
