import type { SimOut } from './messages.js';

/** Minimal port so the worker and a unit test share one transfer path. */
export interface SimPort {
  postMessage(message: SimOut, transfer?: readonly ArrayBuffer[]): void;
}

/**
 * Post a simulation message. Snapshot bytes are copied into a fresh
 * ArrayBuffer and transferred, which detaches that buffer in the sender.
 */
export function postSimOut(port: SimPort, message: SimOut): void {
  if (message.t !== 'snapshot') {
    port.postMessage(message);
    return;
  }
  const view = new Uint8Array(message.bytes);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const buffer = copy.buffer;
  port.postMessage({ ...message, bytes: buffer }, [buffer]);
  if (buffer.byteLength !== 0) {
    throw new Error('snapshot buffer was not detached');
  }
}
