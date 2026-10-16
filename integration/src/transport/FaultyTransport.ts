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
 * Seeded delay / duplicate / reorder / drop in front of a peer.
 *
 * The gate only decides *when* a tick may be applied. The interpreter
 * then applies the authoritative log entry once, so a duplicate does not
 * run twice and a reorder cannot apply tick T+1 before tick T.
 * A drop withholds that tick until {@link retransmit}, which is the
 * peer catching up from the authoritative log (not a transport resend).
 */
export class FaultGate {
  private held: Held[] = [];
  private dropped: LogEntry[] = [];
  private fault: FaultSpec | null = null;

  public setFault(spec: FaultSpec | null): void {
    this.fault = spec;
  }

  public offer(now: number, entry: LogEntry, rng: Prng): void {
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

  public releaseDue(now: number): void {
    const rest: Held[] = [];
    for (const item of this.held) {
      if (item.releaseAt > now) rest.push(item);
    }
    this.held = rest;
  }

  /**
   * End of a fault range. Withheld ticks are released and the interpreter
   * catches the peer up from the authoritative log (not a wire resend).
   */
  public retransmit(): void {
    this.dropped = [];
    this.held = [];
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
