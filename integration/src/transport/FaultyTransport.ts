import type { LogEntry } from '../driver/SimDriver.js';
import type { Prng } from '../util/prng.js';

export interface FaultSpec {
  /** Inclusive delay in ticks. */
  readonly delay: readonly [number, number];
  /** Probability in `[0, 1]`. Converted to an integer threshold out of 10000. */
  readonly dup: number;
  readonly reorder: number;
  readonly drop: number;
}

interface Held {
  entry: LogEntry;
  releaseAt: number;
}

/**
 * Seeded delay / duplicate / reorder / drop in front of one peer.
 *
 * `releaseDue` returns the envelopes that are allowed onto the wire.
 * The interpreter submits those to the peer's `LocalTransport`. A drop
 * stays out of that list; the interpreter later catch-up-replays the
 * authoritative log. `passthrough` delivers every envelope immediately
 * and is the mutant the fault-effect scenario is meant to turn red.
 */
export class FaultGate {
  private held: Held[] = [];
  private dropped: LogEntry[] = [];
  private fault: FaultSpec | null = null;

  public constructor(private readonly passthrough = false) {}

  public setFault(spec: FaultSpec | null): void {
    this.fault = spec;
  }

  public offer(now: number, entry: LogEntry, rng: Prng): void {
    if (this.passthrough) {
      this.held.push({ entry, releaseAt: now });
      return;
    }
    const fault = this.fault;
    if (fault !== null && hit(rng, fault.drop)) {
      this.dropped.push(entry);
      return;
    }
    let delay = 0;
    if (fault !== null) {
      const span = fault.delay[1] - fault.delay[0];
      delay = fault.delay[0] + (span > 0 ? rng.int(span + 1) : 0);
    }
    this.held.push({ entry, releaseAt: now + delay });
    if (fault !== null && hit(rng, fault.dup)) {
      this.held.push({ entry, releaseAt: now + delay });
    }
    if (fault !== null && hit(rng, fault.reorder) && this.held.length >= 2) {
      const last = this.held.length - 1;
      const previous = this.held[last - 1];
      const current = this.held[last];
      if (previous !== undefined && current !== undefined) {
        const at = previous.releaseAt;
        previous.releaseAt = current.releaseAt;
        current.releaseAt = at;
      }
    }
  }

  /** Smallest tick still withheld. `Infinity` when the peer may proceed. */
  public horizon(now: number): number {
    let min = Number.POSITIVE_INFINITY;
    for (const item of this.held) {
      if (item.releaseAt > now && item.entry.tick < min) min = item.entry.tick;
    }
    for (const entry of this.dropped) {
      if (entry.tick < min) min = entry.tick;
    }
    return min;
  }

  /** Envelopes whose delay has elapsed. Dropped envelopes are not included. */
  public releaseDue(now: number): LogEntry[] {
    const due: LogEntry[] = [];
    const rest: Held[] = [];
    for (const item of this.held) {
      if (item.releaseAt <= now) due.push(item.entry);
      else rest.push(item);
    }
    this.held = rest;
    return due;
  }

  public hasDrop(): boolean {
    return this.dropped.length > 0;
  }

  /**
   * End of a fault range. Held envelopes are returned so the caller can
   * still submit them. Drops are forgotten here; the caller catch-up
   * replays the log instead of resending them.
   */
  public retransmit(): LogEntry[] {
    const released = this.held.map((item) => item.entry);
    this.held = [];
    this.dropped = [];
    return released;
  }
}

function hit(rng: Prng, probability: number): boolean {
  const ppm = partsPer(probability);
  if (ppm <= 0) return false;
  if (ppm >= 10_000) return true;
  return rng.int(10_000) < ppm;
}

function partsPer(probability: number): number {
  if (!Number.isFinite(probability) || probability <= 0) return 0;
  if (probability >= 1) return 10_000;
  return Math.round(probability * 10_000);
}
