import type {
  GameSystem,
  GameWorld,
  IRandom,
  PoolingConfig,
} from '@phalanx-engine/ecs';
import type { BotPolicyFactory } from '../runner/BotPolicy.js';
import type { SaveSpec } from '../state/GameState.js';
import type { GameCommand, StampedCommand } from './commands.js';
import type { DefinedCommands } from './defineCommands.js';
import type { MatchConfigBase, SlotInfo } from './MatchConfig.js';

/**
 * Handed to `onStart`. The runner owns the world and the tick loop.
 * `open` prewarms pools and subscribes the world to that loop. Call it
 * before spawning pooled entities. If `onStart` returns without calling
 * it, the runner does.
 */
export interface StartContext<Cfg> {
  readonly world: GameWorld;
  readonly rng: IRandom;
  readonly config: Cfg;
  readonly slots: readonly SlotInfo[];
  readonly purpose: 'fresh' | 'restore';
  open(): void;
}

/** `onStart` context plus the simulation object commands and outcome see. */
export interface GameContext<Sim, Cfg> {
  readonly world: GameWorld;
  readonly rng: IRandom;
  readonly config: Cfg;
  readonly slots: readonly SlotInfo[];
  readonly purpose: 'fresh' | 'restore';
  readonly sim: Sim;
}

/** Simulation root. The world is authoritative; commands go through `onCommand`. */
export interface SimWorld {
  readonly world: GameWorld;
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

export type CommandHandlerMap<
  Cmd extends GameCommand,
  Sim,
  Cfg extends MatchConfigBase,
> = {
  [K in Cmd['type']]: {
    bivarianceHack(
      ctx: GameContext<Sim, Cfg>,
      stamped: StampedCommand<Extract<Cmd, { readonly type: K }>>
    ): void;
  }['bivarianceHack'];
};

/**
 * `SoASchema` is invariant in its field map, so a concrete
 * `defineComponent` result is not a `ComponentRegistration` of the wide
 * schema. The runner only needs the values `registerComponent` reads.
 */
export interface GameComponent {
  readonly name: string;
  readonly schema: object;
  readonly type: symbol;
  create(
    entityId: number,
    values?: Readonly<Partial<Record<string, number | bigint>>>
  ): object;
}

type CommandCallback<
  Cmd extends GameCommand,
  Sim,
  Cfg extends MatchConfigBase,
> = {
  // Method form: parameters stay bivariant so a concrete game is
  // assignable to `AnyGameDefinition`.
  bivarianceHack(
    ctx: GameContext<Sim, Cfg>,
    stamped: StampedCommand<Cmd>
  ): void;
}['bivarianceHack'];

export type OnCommand<
  Cmd extends GameCommand,
  Sim,
  Cfg extends MatchConfigBase,
> = CommandCallback<Cmd, Sim, Cfg> | CommandHandlerMap<Cmd, Sim, Cfg>;

/** Everything the engine needs to run, snapshot and host a game. */
export interface GameDefinition<
  Cfg extends MatchConfigBase = MatchConfigBase,
  Cmd extends GameCommand = GameCommand,
  Sim extends SimWorld = SimWorld,
> {
  /** Stable id; equals the server `gameTypes[].gameType` in server mode. */
  readonly id: string;
  /** Changes on any simulation change; checked against snapshots/replays. */
  readonly simVersion: string;
  /** Integer ticks per second; must equal the server tick rate. */
  readonly tickRate: number;
  /**
   * Registered in array order before `onStart`. Order is part of
   * `configHash`.
   */
  readonly components?: readonly GameComponent[];
  /**
   * Tick-system factories. Restore builds a new world, so instances are not
   * reused. The runner adds each one in the `late` phase. A system that
   * must run in another phase is added from `onStart` with `world.addSystem`.
   */
  readonly systems?: readonly (() => GameSystem)[];
  /**
   * Frame-system factories, added in the `render` phase. Same restore rule
   * as {@link GameDefinition.systems}.
   */
  readonly frameSystems?: readonly (() => GameSystem)[];
  /** Passed to the engine-owned `GameWorld`. */
  readonly pooling?: PoolingConfig;
  readonly commands: DefinedCommands<Cmd>;
  /**
   * Wire physics, abilities and opening entities. Return a custom sim
   * object, or return nothing and the engine keeps `{ world }`.
   * On `'restore'`, spawn only what the snapshot will overwrite or skip.
   */
  onStart?(ctx: StartContext<Cfg>): Sim | void;
  /**
   * A concrete command union keeps the typed callback. The wide default
   * (`GameCommand`, whose `type` is `string`) stores `object` so a specific
   * handler map is assignable to {@link AnyGameDefinition}.
   */
  readonly onCommand: string extends Cmd['type']
    ? object
    : OnCommand<Cmd, Sim, Cfg>;
  readonly bots?: Readonly<Record<string, BotPolicyFactory<Cfg, Cmd, Sim>>>;
  /** Pure: `null` while the match is running. Called after every tick. */
  checkOutcome(sim: Readonly<Sim>): MatchOutcome | null;
  /**
   * Custom snapshot. Omitted: the world modules (`formatVersion` 1).
   * `handler` replaced `state.bind`.
   */
  readonly save: SaveSpec<Sim>;
}

export type AnyGameDefinition = GameDefinition<
  MatchConfigBase,
  GameCommand,
  SimWorld
>;

export type ConfigOf<G> =
  G extends GameDefinition<infer C, infer _M, infer _S> ? C : never;
export type CommandOf<G> =
  G extends DefinedCommands<infer Cmd>
    ? Cmd
    : G extends GameDefinition<infer _C, infer M, infer _S>
      ? M
      : never;
export type SimOf<G> =
  G extends GameDefinition<infer _C, infer _M, infer S> ? S : never;

/** Stamped command whose payload is `CommandOf<T>`. */
export type StampedCommandOf<T> = StampedCommand<CommandOf<T>>;
