/**
 * Version of the engine-owned snapshot wrapper (header + body + extras).
 * 3 writes module sections in a `modules` container, ordered by key.
 * There is no migration from 1 or 2: those snapshots are rejected.
 */
export const ENGINE_SNAPSHOT_FORMAT = 3;

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
