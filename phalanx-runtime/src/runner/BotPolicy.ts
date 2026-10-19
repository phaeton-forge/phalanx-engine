import type { IRandom } from '@phalanx-engine/ecs';
import type { GameCommand } from '../game/commands.js';
import type { BotSlotInfo, MatchConfigBase } from '../game/MatchConfig.js';
import type { StateReader, StateWriter } from '@phalanx-engine/ecs';

/**
 * A bot is a command producer, not a simulation system. It reads the
 * simulation after a tick and returns commands; the runner logs them like a
 * human's and executes them at `tick + inputDelayTicks`. A finished replay
 * (`MatchRunner.fromReplay`) never runs the bot: every command it produced
 * is already in the log. The same is true for a client watching server
 * bots.
 *
 * Local resume is the exception. The hosting side's policy must continue,
 * or its next live decision diverges from a match that never paused:
 * - the snapshot stores policy state after `decide(snapshotTick)`;
 * - with no log tail, restore that state and the input checkpoint, and do
 *   not call `decide` again for the snapshot tick;
 * - with a log tail through L, restore the policy state, discard the
 *   checkpoint (the log already contains those commands) and call `decide`
 *   after every replayed tick. Submit the result only when its target tick
 *   is greater than L; otherwise drop it, but still advance the policy.
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
