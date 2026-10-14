import type { GameCommand } from '../game/commands.js';
import type {
  AnyGameDefinition,
  CommandOf,
  ConfigOf,
  SimOf,
} from '../game/GameDefinition.js';
import { notImplemented } from '../notImplemented.js';
import type { StateReader, StateWriter } from '../state/StateIO.js';
import type { RunnerSide } from './MatchRunner.js';

export interface BotDecision<Cmd extends GameCommand = GameCommand> {
  readonly slot: number;
  readonly commands: readonly Cmd[];
}

/**
 * Instantiates the policies of the bot slots hosted on `side` (one
 * `DeterministicRandom` per slot, seeded from `(config.seed, slot)`) and
 * collects their decisions after each tick, slot ascending.
 */
export class BotHost<G extends AnyGameDefinition> {
  public constructor(_definition: G, _config: ConfigOf<G>, _side: RunnerSide) {
    notImplemented('BotHost', 6);
  }

  /** Hosted bot slots, ascending. */
  public get slots(): readonly number[] {
    return notImplemented('BotHost.slots', 6);
  }

  public decideAll(
    _sim: Readonly<SimOf<G>>,
    _tick: number
  ): readonly BotDecision<CommandOf<G>>[] {
    return notImplemented('BotHost.decideAll', 6);
  }

  /** Bot state section of a snapshot (outside the digest). */
  public save(_w: StateWriter): void {
    notImplemented('BotHost.save', 6);
  }

  public restore(_r: StateReader): void {
    notImplemented('BotHost.restore', 6);
  }
}
