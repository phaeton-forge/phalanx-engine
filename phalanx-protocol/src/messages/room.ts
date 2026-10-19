/** `room-created`. Sent to the host. */
export interface RoomCreatedEvent {
  code: string;
}

/** `room-recovered`. The stored code, uppercased by the server. */
export interface RoomRecoveredEvent {
  code: string;
}

/**
 * `room-error`.
 * `session-token-required` refuses an in-match `room-recover` when
 * `reconnect.requireSessionToken` is on.
 * `sim-unavailable` refuses a server room after the sim worker has died.
 * Other failures omit `reason`.
 */
export interface RoomErrorEvent {
  message: string;
  reason?: 'session-token-required' | 'sim-unavailable';
}

/** `room-expired`. */
export interface RoomExpiredEvent {
  code: string;
}

/** `room-cancelled`. */
export interface RoomCancelledEvent {
  code: string;
}
