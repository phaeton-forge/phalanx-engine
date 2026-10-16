import type {
  GameWorld,
  IRandom,
  ITickFrameProvider,
} from '@phalanx-engine/ecs';
import type { BotPolicyFactory } from '../runner/BotPolicy.js';
import type { GameStateSpec } from '../state/GameState.js';
import type { CommandSchema, GameCommand, StampedCommand } from './commands.js';
import type { MatchConfigBase } from './MatchConfig.js';

/**
 * Handed to `GameDefinition.createWorld`. The runner owns the tick loop:
 * the game MUST construct its `GameWorld` with
 * `{ tickFrameProvider: ctx.tickFrameProvider, random: ctx.random }` and call
 * `world.start(hooks)` before returning. The runner then drives the
 * standard `world.start()` pipeline tick by tick; no code calls
 * `processAllTicks` directly.
 */
export interface WorldInitContext {
  /** Runner-owned provider. Ticks carry an empty `CommandsBatch`. */
  readonly tickFrameProvider: ITickFrameProvider;
  /** Match RNG seeded from `config.seed`. */
  readonly random: IRandom;
  /**
   * `'fresh'`: build the tick-0 world, including the opening roster.
   * `'restore'`: static content only (systems, pools, registries,
   * `world.start()`). Do not spawn. `GameState.restore` recreates dynamic
   * entities by id into that empty world. A spawn here leaves the id
   * registered and `spawnWithId` throws `entity N already exists`.
   */
  readonly purpose: 'fresh' | 'restore';
}

/** The game's simulation root, returned by `createWorld`. */
export interface SimWorld<Cmd extends GameCommand = GameCommand> {
  readonly world: GameWorld;
  /**
   * Apply one validated command. Called inside the tick, before the tick
   * systems run, once per accepted command in canonical order
   * (slot ascending, then `seq` ascending).
   */
  applyCommand(command: StampedCommand<Cmd>): void;
  /** Optional teardown beyond `world.dispose()`. */
  dispose?(): void;
}

export interface MatchOutcomeWin {
  readonly kind: 'win';
  readonly winnerTeam: number;
  readonly reason: string;
}

export interface MatchOutcomeDraw {
  readonly kind: 'draw';
  readonly reason: string;
}

/** Result decided by the simulation. Relay-level endings are separate. */
export type MatchOutcome = MatchOutcomeWin | MatchOutcomeDraw;

/** Everything the engine needs to run, snapshot and host a game. */
export interface GameDefinition<
  Cfg extends MatchConfigBase = MatchConfigBase,
  Cmd extends GameCommand = GameCommand,
  Sim extends SimWorld<Cmd> = SimWorld<Cmd>,
> {
  /** Stable id; equals the server `gameTypes[].gameType` in server mode. */
  readonly id: string;
  /** Changes on any simulation change; checked against snapshots/replays. */
  readonly simVersion: string;
  /** Integer ticks per second; must equal the server tick rate. */
  readonly tickRate: number;
  /** Deterministic world creation from the config. */
  createWorld(config: Cfg, ctx: WorldInitContext): Sim;
  readonly commands: CommandSchema<Cmd, Sim>;
  /** Snapshot contract (approved 2026-10-14). */
  readonly state: GameStateSpec<Sim>;
  /** Bot policies by name (`BotSlotConfig.policy`). */
  readonly bots?: Readonly<Record<string, BotPolicyFactory<Cfg, Cmd, Sim>>>;
  /** Pure: `null` while the match is running. Called after every tick. */
  outcome(sim: Readonly<Sim>): MatchOutcome | null;
}

/**
 * Any game definition, e.g. for `PhalanxConfig.games`. Every concrete
 * `GameDefinition<C, M, S>` is assignable to it.
 */
export type AnyGameDefinition = GameDefinition<
  MatchConfigBase,
  GameCommand,
  SimWorld
>;

export type ConfigOf<G> =
  G extends GameDefinition<infer C, infer _M, infer _S> ? C : never;
export type CommandOf<G> =
  G extends GameDefinition<infer _C, infer M, infer _S> ? M : never;
export type SimOf<G> =
  G extends GameDefinition<infer _C, infer _M, infer S> ? S : never;
