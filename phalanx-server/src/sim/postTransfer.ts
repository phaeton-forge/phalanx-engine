import type { SimOut } from './messages.js';

/** Minimal port so the worker and a unit test share one transfer path. */
export interface SimPort {
  postMessage(message: SimOut, transfer?: readonly ArrayBuffer[]): void;
}

/**
 * Post a simulation message. Snapshot `bytes` are the one copy the sim
 * made; this transfers that buffer and detaches it in the sender.
 */
export function postSimOut(port: SimPort, message: SimOut): void {
  if (message.t !== 'snapshot') {
    port.postMessage(message);
    return;
  }
  const buffer = message.bytes;
  port.postMessage(message, [buffer]);
  if (buffer.byteLength !== 0) {
    throw new Error('snapshot buffer was not detached');
  }
}
