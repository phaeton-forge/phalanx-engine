import type { IRandom } from '@phalanx-engine/ecs';
import type { GameCommand } from '../game/commands.js';
import type { BotSlotInfo, MatchConfigBase } from '../game/MatchConfig.js';
import type { StateReader, StateWriter } from '../state/StateIO.js';

/**
 * A bot is a command producer, not a simulation system. It reads the
 * simulation after a tick and returns commands; the runner logs them like a
 * human's and executes them at `tick + inputDelayTicks`. Replays and
 * reconnects therefore never run the bot.
 *
 * Only the side that hosts the slot (`BotSlotConfig.runsOn`) runs the
 * policy, so bot state is NOT simulation state: it is never part of
 * `GameState` and never hashed.
 */
export interface BotPolicy<
  Cmd extends GameCommand = GameCommand,
  Sim = unknown,
> {
  /**
   * Called after tick `tick` completed. MUST NOT mutate `sim`. Returned
   * commands execute at `tick + config.inputDelayTicks`.
   */
  decide(sim: Readonly<Sim>, tick: number): readonly Cmd[];
  /** Persist private state (plans, timers, RNG) for local resume. */
  save?(w: StateWriter): void;
  restore?(r: StateReader): void;
}

/**
 * `rng` is a fresh `DeterministicRandom` seeded from
 * `(config.seed, slot.slot)`; it is owned by the policy.
 */
export type BotPolicyFactory<
  Cfg extends MatchConfigBase = MatchConfigBase,
  Cmd extends GameCommand = GameCommand,
  Sim = unknown,
> = {
  // Method-signature form keeps the parameters bivariant, so a concrete
  // game definition stays assignable to `AnyGameDefinition`.
  create(config: Cfg, slot: BotSlotInfo, rng: IRandom): BotPolicy<Cmd, Sim>;
}['create'];
