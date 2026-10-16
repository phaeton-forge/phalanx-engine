import { REPLAY_FORMAT } from '../constants.js';
import type { AnyGameDefinition, ConfigOf } from '../game/GameDefinition.js';
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

/** Throws when a recording cannot be re-run with `definition`. */
export function assertReplayRecord<G extends AnyGameDefinition>(
  definition: G,
  replay: ReplayRecord<ConfigOf<G>>
): void {
  if (replay.format !== REPLAY_FORMAT) {
    throw new Error(`replay: format ${String(replay.format)} is not supported`);
  }
  if (replay.gameId !== definition.id) {
    throw new Error(
      `replay: gameId '${replay.gameId}' does not match '${definition.id}'`
    );
  }
  if (replay.simVersion !== definition.simVersion) {
    throw new Error(
      `replay: simVersion '${replay.simVersion}' does not match '${definition.simVersion}'`
    );
  }
  if (!Number.isInteger(replay.lastTick) || replay.lastTick < -1) {
    throw new Error(
      `replay: lastTick must be an integer >= -1, got ${String(replay.lastTick)}`
    );
  }
  for (const entry of replay.log) {
    if (
      !Number.isInteger(entry.tick) ||
      entry.tick < 0 ||
      entry.tick > replay.lastTick
    ) {
      throw new Error(
        `replay: entry tick ${String(entry.tick)} is outside 0..${String(replay.lastTick)}`
      );
    }
  }
}
