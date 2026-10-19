/**
 * Version of the engine-owned snapshot wrapper (header + body + extras).
 * 2 adds the component-schema tail from 6.5a. There is no migration from
 * 1: a format-1 snapshot is rejected.
 */
export const ENGINE_SNAPSHOT_FORMAT = 2;

/** First four bytes of every snapshot produced by the runtime. */
export const SNAPSHOT_MAGIC = 'PHXS';

/** Version of {@link ReplayRecord}. */
export const REPLAY_FORMAT = 1;

/** Server-mode periodic snapshot interval (persistence only, not catch-up). */
export const DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS = 1000;

/** Client-mode periodic snapshot interval (IndexedDB resume). */
export const DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS = 300;

/** How often a runner computes and publishes its state digest. */
export const DEFAULT_HASH_EVERY_TICKS = 60;

export { DEFAULT_INPUT_DELAY_TICKS } from '@phalanx-engine/protocol';
