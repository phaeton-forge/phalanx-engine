/** Where the authoritative copy of the simulation runs besides the clients. */
export type SimMode = 'client' | 'server';

/** Which runner side hosts a bot slot's policy. */
export type BotHostSide = 'local' | 'server';

export interface HumanSlotConfig {
  readonly slot: number;
  readonly team: number;
  readonly kind: 'human';
  /**
   * Stable player id. Network transports: the server-side id the relay
   * stamps on commands. LocalTransport: any unique string, e.g. `'local:0'`.
   */
  readonly playerId: string;
}

export interface BotSlotConfig {
  readonly slot: number;
  readonly team: number;
  readonly kind: 'bot';
  /** Key into `GameDefinition.bots`. */
  readonly policy: string;
  /** Integer difficulty passed to the policy factory. */
  readonly level: number;
  /**
   * `'server'` is the only valid value in `simMode: 'server'`; `'local'` is
   * the only valid value in `simMode: 'client'`.
   */
  readonly runsOn: BotHostSide;
}

export type SlotConfig = HumanSlotConfig | BotSlotConfig;

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
  /** Must equal `GameDefinition.id`. */
  readonly gameId: string;
  /** Must equal `GameDefinition.simVersion`. */
  readonly simVersion: string;
  /** Unsigned 32-bit match seed (`GameRoom` `randomSeed` in server mode). */
  readonly seed: number;
  readonly simMode: SimMode;
  /** Sorted ascending by `slot`, contiguous from 0. */
  readonly slots: readonly Slot[];
  /** Integer `>= 1`; must not exceed the server's `maxTickAhead`. */
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
