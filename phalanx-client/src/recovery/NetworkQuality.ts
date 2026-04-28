/**
 * NetworkQuality — read `navigator.connection` (when available) to pick
 * a sensible recover-room request timeout. Mobile carrier networks can
 * legitimately take 15+ seconds to deliver an ack on slow-2g, so a
 * fixed 10s timeout would prematurely fail recovery on real mobile.
 */

interface NetworkInformationLike {
  readonly effectiveType?: string;
  readonly rtt?: number;
}

interface NavigatorWithConnection extends Navigator {
  readonly connection?: NetworkInformationLike;
  readonly mozConnection?: NetworkInformationLike;
  readonly webkitConnection?: NetworkInformationLike;
}

export interface RecoverTimeoutBudget {
  /** Default timeout when the network looks healthy. */
  defaultMs: number;
  /** Used for 3g / 300+ms RTT. */
  degradedMs: number;
  /** Used for slow-2g / 2g / 600+ms RTT. */
  slowMs: number;
}

export const DEFAULT_RECOVER_TIMEOUT_BUDGET: RecoverTimeoutBudget = {
  defaultMs: 10_000,
  degradedMs: 15_000,
  slowMs: 25_000,
};

/**
 * Pick a recover-room ack timeout for the current network quality.
 * Returns `budget.defaultMs` when no `navigator.connection` data is
 * available (older Safari, non-DOM environments, …).
 */
export function getRecoverTimeoutMs(
  budget: RecoverTimeoutBudget = DEFAULT_RECOVER_TIMEOUT_BUDGET
): number {
  if (typeof navigator === 'undefined') return budget.defaultMs;
  const nav = navigator as NavigatorWithConnection;
  const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;

  if (
    connection?.effectiveType === 'slow-2g' ||
    connection?.effectiveType === '2g'
  ) {
    return budget.slowMs;
  }
  if (typeof connection?.rtt === 'number' && connection.rtt >= 600) {
    return budget.slowMs;
  }
  if (
    connection?.effectiveType === '3g' ||
    (typeof connection?.rtt === 'number' && connection.rtt >= 300)
  ) {
    return budget.degradedMs;
  }
  return budget.defaultMs;
}

