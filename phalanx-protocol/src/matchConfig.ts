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
   * Which runner hosts this bot. `'local'` with `side: 'client'`,
   * `'server'` with `side: 'server'`. A peer whose `side` does not match
   * ignores the bot's policy state.
   */
  readonly runsOn: BotHostSide;
}

export type SlotConfig = HumanSlotConfig | BotSlotConfig;

/**
 * `room-create` body that starts a server-simulated match.
 * `Extra` is that game's `configKeys`. A key outside this type fails
 * at compile time. The server still copies an integer only when
 * `configKeys` lists it.
 */
export type ServerRoomMatchConfig<
  Extra extends Record<string, number> = Record<never, never>,
> = {
  gameId: string;
  simMode: 'server';
  slots: readonly SlotConfig[];
  inputDelayTicks?: number;
  /** Bot policy used when an absent human is replaced. Requires `absence`. */
  absencePolicy?: string;
} & Extra;
