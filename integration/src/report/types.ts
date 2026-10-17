import type { FieldDiff } from '../oracle/oracle.js';
import type { TimelineEvent } from '../dsl/scenario.js';
import type { StateDump } from '../driver/SimDriver.js';

export type Status = 'pass' | 'skip' | 'warn' | 'fail' | 'known';

export interface PerfRow {
  readonly metric: string;
  readonly baseline: number | null;
  readonly current: number;
  readonly deltaPct: number | null;
  readonly worse: boolean;
}

export interface CaseResult {
  readonly name: string;
  readonly suite: string;
  readonly tags: readonly string[];
  readonly status: Status;
  readonly ticks: number;
  readonly timeMs: number;
  readonly note: string;
  /** Peer count for a multi-process case such as det-continuous. */
  readonly peers?: number;
  /** OS processes for a multi-process case such as det-continuous. */
  readonly processes?: number;
  readonly seed?: number;
  readonly tick?: number;
  readonly diffs?: readonly FieldDiff[];
  /** Pre-save dump for a round-trip failure. */
  readonly before?: StateDump;
  /** Post-restore dump for a round-trip failure. */
  readonly after?: StateDump;
  /** Who controlled each slot after each tick of a handoff. */
  readonly controller?: readonly {
    readonly tick: number;
    readonly slots: readonly {
      readonly slot: number;
      readonly mode: 'human' | 'bot';
    }[];
  }[];
  readonly timeline?: readonly TimelineEvent[];
  readonly repro?: string;
  readonly perf?: readonly PerfRow[];
}

export interface ReportHeader {
  readonly pr: string;
  readonly head: string;
  readonly base: string;
  readonly node: string;
  readonly pnpm: string;
  readonly os: string;
  readonly profile: string;
  readonly seeds: readonly number[];
  readonly durationMs: number;
}

export interface Report {
  readonly header: ReportHeader;
  readonly cases: readonly CaseResult[];
}
