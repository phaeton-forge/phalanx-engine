/**
 * Relay ↔ simulation messages. JSON-safe except snapshot bytes, which are
 * an ArrayBuffer transferred across the worker boundary. No functions,
 * no shared objects, no SharedArrayBuffer.
 */

export interface SimCommand {
  type: string;
  tick: number;
  playerId: string;
  data: unknown;
  sequence?: number;
}

export interface SimOutcomeWin {
  kind: 'win';
  winnerTeam: number;
  reason: string;
}

export interface SimOutcomeDraw {
  kind: 'draw';
  reason: string;
}

export type SimOutcome = SimOutcomeWin | SimOutcomeDraw;

export type SimIn =
  | {
      t: 'open';
      matchId: string;
      module: string;
      exportName?: string;
      config: { readonly [key: string]: unknown };
      snapshotEveryTicks: number;
      hashEveryTicks: number;
    }
  | {
      t: 'batch';
      matchId: string;
      tick: number;
      commands: SimCommand[];
    }
  | { t: 'snapshot'; matchId: string; requestId: number }
  | { t: 'setController'; matchId: string; command: SimCommand }
  | { t: 'end'; matchId: string }
  | { t: 'close' };

export type SimOut =
  | { t: 'opened'; matchId: string }
  | {
      t: 'botCommands';
      matchId: string;
      tick: number;
      commands: SimCommand[];
    }
  | { t: 'digest'; matchId: string; tick: number; digest: string }
  | { t: 'tick'; matchId: string; tick: number }
  | {
      t: 'snapshot';
      matchId: string;
      tick: number;
      requestId?: number;
      bytes: ArrayBuffer;
    }
  | { t: 'event'; matchId: string; outcome: SimOutcome }
  | { t: 'sim-error'; matchId: string; message: string }
  | { t: 'sim-crash'; matchId: string; message: string }
  | { t: 'sim-oom'; matchId: string; message: string }
  | { t: 'ended'; matchId: string };

export function simFaultKind(
  error: unknown
): 'sim-crash' | 'sim-error' | 'sim-oom' {
  if (error instanceof Error && error.name === 'SimCrashError') {
    return 'sim-crash';
  }
  if (isHeapOom(error)) return 'sim-oom';
  return 'sim-error';
}

/** Real isolate failures only. A game `Error` message is not an OOM. */
function isHeapOom(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ERR_WORKER_OUT_OF_MEMORY' || code === 'ERR_OUT_OF_MEMORY';
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
