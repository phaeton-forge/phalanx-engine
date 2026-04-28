import type { SocketTransport } from '../types.js';

/**
 * Best-effort mobile-browser sniffing. Used by `PhalanxClient` to
 * default `socketTransports` to polling when `mobileFriendlyTransports`
 * is opted into — Telegram WebView / iOS Safari on carrier networks
 * frequently establish a websocket and then silently stop delivering
 * packets, while polling reconnects transparently.
 */
export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent;
  const platform = navigator.platform;
  const hasTouchScreen = navigator.maxTouchPoints > 1;
  const isIpadOS = platform === 'MacIntel' && hasTouchScreen;
  return (
    isIpadOS ||
    /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent)
  );
}

const DESKTOP_TRANSPORTS = ['websocket'] as const satisfies readonly SocketTransport[];
const MOBILE_TRANSPORTS = ['polling'] as const satisfies readonly SocketTransport[];

/** Resolve the auto-defaulted transport list for the current UA. */
export function pickMobileFriendlyTransports(): readonly SocketTransport[] {
  return isMobileBrowser() ? MOBILE_TRANSPORTS : DESKTOP_TRANSPORTS;
}

