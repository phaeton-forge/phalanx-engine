import type { SlotInfo } from './MatchConfig.js';

/**
 * JSON-safe value. Command payloads and match configs cross socket.io as
 * JSON, so `bigint` (FixedPoint raw values), `undefined`, `NaN` and class
 * instances are not allowed. Send FP values as decimal strings of the raw
 * value and convert inside `CommandSchema.decode`.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Base shape of a game command. Games use a discriminated union. */
export interface GameCommand {
  readonly type: string;
}

/** A decoded command bound to its execution tick and issuing slot. */
export interface StampedCommand<Cmd extends GameCommand = GameCommand> {
  readonly tick: number;
  readonly slot: number;
  /** Per-slot submission sequence; orders a slot's commands within a tick. */
  readonly seq: number;
  readonly command: Cmd;
}

export interface CommandRejection {
  readonly rejected: true;
  readonly reason: string;
}

export function rejectCommand(reason: string): CommandRejection {
  return { rejected: true, reason };
}

export function isCommandRejection(value: unknown): value is CommandRejection {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { rejected?: unknown }).rejected === true
  );
}

/**
 * Command contract shared by the client, the server and bots.
 *
 * `decode` is structural only (no simulation access) so the server can
 * pre-filter garbage before stamping. `validate` is the authoritative,
 * state-dependent check and runs inside the tick on every peer, right
 * before `SimWorld.applyCommand`, in canonical order.
 */
export interface CommandSchema<Cmd extends GameCommand, Sim> {
  /** Every `Cmd['type']`; used for wire-level filtering. */
  readonly types: readonly Cmd['type'][];
  /** Pure: untrusted wire payload → typed command or rejection. */
  decode(raw: unknown, slot: SlotInfo): Cmd | CommandRejection;
  /** Pure and deterministic; reads `sim`, never mutates it. */
  validate?(
    command: Cmd,
    slot: SlotInfo,
    sim: Readonly<Sim>
  ): CommandRejection | null;
  /** Typed command → JSON-safe payload. Defaults to the command itself. */
  encode?(command: Cmd): JsonValue;
}

/**
 * The `data` of every `PlayerCommand` produced by the runtime. Always
 * defined: the relay drops commands whose `data` is `undefined`.
 */
export interface CommandEnvelope {
  /** Per-slot sequence number. */
  readonly q: number;
  /** Encoded command (`CommandSchema.encode`). */
  readonly p: JsonValue;
}

/** One command as handed to a transport's `submit`. */
export interface TransportCommand {
  readonly type: string;
  readonly data: CommandEnvelope;
}
