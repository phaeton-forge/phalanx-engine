import type { SlotConfig } from '@phalanx-engine/protocol';

/**
 * Which process this runner is. `'client'` hosts `runsOn: 'local'` bots.
 * `'server'` hosts `runsOn: 'server'` bots. Replaces `simMode` and the
 * runner `side` option: one field, on the config.
 */
export type SimMode = 'client' | 'server';

export type {
  BotHostSide,
  BotSlotConfig,
  HumanSlotConfig,
  SlotConfig,
} from '@phalanx-engine/protocol';

/**
 * Engine-owned part of a match config. Games extend it (and may extend the
 * slot type, e.g. `SlotConfig & { faction: 'guard' | 'swarm' }`).
 *
 * The whole config, including game extensions, MUST be JSON-safe with
 * integer numbers only: it is sent over the wire by the server and hashed
 * canonically (`canonicalConfigBytes`) into the snapshot header.
 */
export interface MatchConfigBase<Slot extends SlotConfig = SlotConfig> {
  readonly matchId: string;
  /** Must equal `GameDefinition.id`. Filled from the definition when omitted. */
  readonly gameId: string;
  /** Must equal `GameDefinition.simVersion`. Filled from the definition when omitted. */
  readonly simVersion: string;
  /** Unsigned 32-bit match seed (`GameRoom` `randomSeed` in server mode). */
  readonly seed: number;
  /** This runner's role. Replaces `simMode`. */
  readonly side: SimMode;
  /** Sorted ascending by `slot`, contiguous from 0. */
  readonly slots: readonly Slot[];
  /**
   * Integer `>= 1`; must not exceed the server's `maxTickAhead`.
   * Defaults to `DEFAULT_INPUT_DELAY_TICKS` (2) when omitted.
   */
  readonly inputDelayTicks: number;
}

/** Read-only identity of a slot as seen by validators and bots. */
export interface SlotInfo {
  readonly slot: number;
  readonly team: number;
  readonly kind: 'human' | 'bot';
  /** Human: `HumanSlotConfig.playerId`; bot: `bot:<slot>`. */
  readonly playerId: string;
}

export interface BotSlotInfo extends SlotInfo {
  readonly kind: 'bot';
  readonly policy: string;
  readonly level: number;
}
