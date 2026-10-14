import type { MatchConfigBase } from '../game/MatchConfig.js';
import type { Digest } from '../state/snapshot.js';
import type { LogEntry } from './CommandLog.js';

/** A full match recording: config + raw command log. JSON-safe. */
export interface ReplayRecord<Cfg extends MatchConfigBase = MatchConfigBase> {
  /** {@link REPLAY_FORMAT}. */
  readonly format: number;
  readonly gameId: string;
  readonly simVersion: string;
  readonly config: Cfg;
  readonly log: readonly LogEntry[];
  /** Last tick the recording covers (empty ticks are not stored). */
  readonly lastTick: number;
  /** Digest at `lastTick`, when known; replays verify it. */
  readonly finalDigest?: Digest;
}
