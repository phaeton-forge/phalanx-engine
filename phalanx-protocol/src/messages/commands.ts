/**
 * What the server delivers: the command after it stamps `playerId` and
 * `tick`. This is the form in `commands-batch`, the command log, and
 * `player-command`.
 */
export interface PlayerCommand {
  type: string;
  tick: number;
  playerId: string;
  data: unknown;
  /** Optional sequence number for input validation (monotonically increasing per player) */
  sequence?: number;
}

/**
 * What the client sends: one command inside `submit-commands`. The server
 * copies `type`, `data`, and `sequence`, then stamps `playerId` and `tick`.
 */
export interface SubmittedCommand {
  type: string;
  data: unknown;
  sequence?: number;
}

/** Client → server. Commands for one tick. An empty array is valid. */
export interface SubmitCommandsEvent {
  tick: number;
  commands: SubmittedCommand[];
}

/** Server → clients. Stamped commands for one tick, in sorted order. */
export interface CommandsBatchEvent {
  tick: number;
  commands: PlayerCommand[];
}

/** Server → submitting socket, on `submit-commands-ack`. */
export interface SubmitCommandsAck {
  tick: number;
  accepted: boolean;
  reason?: string;
  /** Present when sequence checks rejected one or more commands. */
  rejectedCount?: number;
}
