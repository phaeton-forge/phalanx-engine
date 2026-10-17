/**
 * Where a peer's runner lives.
 *
 * L1 is in-process (this stage). L2 is a child process behind a chaos
 * proxy. L3 is a browser page. See `integration/docs/stage-b.md`.
 */
export type HostLevel = 'L1' | 'L2' | 'L3';

export interface PeerHost {
  readonly level: HostLevel;
  /** `restartServer` is false on L1. */
  supports(feature: 'restartServer' | 'browserReload'): boolean;
}

export function inProcessHost(): PeerHost {
  return {
    level: 'L1',
    supports(): boolean {
      return false;
    },
  };
}
