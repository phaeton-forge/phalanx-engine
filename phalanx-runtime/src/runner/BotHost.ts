import { DeterministicRandom } from '@phalanx-engine/math';
import type { GameCommand } from '../game/commands.js';
import type {
  AnyGameDefinition,
  CommandOf,
  ConfigOf,
  SimOf,
} from '../game/GameDefinition.js';
import type { BotSlotConfig, BotSlotInfo } from '../game/MatchConfig.js';
import { botPlayerId } from '../constants.js';
import { BinaryStateReader, BinaryStateWriter } from '../state/BinaryState.js';
import type { StateReader, StateWriter } from '../state/StateIO.js';
import type { BotPolicy } from './BotPolicy.js';
import type { RunnerSide } from './MatchRunner.js';

export interface BotDecision<Cmd extends GameCommand = GameCommand> {
  readonly slot: number;
  readonly commands: readonly Cmd[];
}

interface HostedBot<G extends AnyGameDefinition> {
  readonly slot: number;
  readonly rng: DeterministicRandom;
  readonly policy: BotPolicy<CommandOf<G>, SimOf<G>>;
}

const CLIENT_SIDE = 0;
const SERVER_SIDE = 1;
const RNG_WORDS = 4;

/**
 * Instantiates the policies of the bot slots hosted on `side` (one
 * `DeterministicRandom` per slot, seeded from `(config.seed, slot)`) and
 * collects their decisions after each tick, slot ascending.
 *
 * Saved bytes start with the hosting side. A runner whose side differs
 * (a client reading a server snapshot) parses the section and applies
 * nothing. Slots this host does not run are skipped the same way.
 */
export class BotHost<G extends AnyGameDefinition> {
  private readonly hosted: readonly HostedBot<G>[];
  private readonly sideTag: number;

  public constructor(definition: G, config: ConfigOf<G>, side: RunnerSide) {
    this.sideTag = side === 'server' ? SERVER_SIDE : CLIENT_SIDE;
    const slots = config.slots
      .filter((slot): slot is BotSlotConfig => {
        if (slot.kind !== 'bot') return false;
        return side === 'server'
          ? slot.runsOn === 'server'
          : slot.runsOn === 'local';
      })
      .slice()
      .sort((a, b) => a.slot - b.slot);

    this.hosted = slots.map((slot): HostedBot<G> => {
      const policies = definition.bots;
      const factory = policies?.[slot.policy];
      if (factory === undefined) {
        throw new Error(
          `BotHost: no policy '${slot.policy}' for slot ${String(slot.slot)}`
        );
      }
      const info: BotSlotInfo = {
        slot: slot.slot,
        team: slot.team,
        kind: 'bot',
        playerId: botPlayerId(slot.slot),
        policy: slot.policy,
        level: slot.level,
      };
      const rng = new DeterministicRandom(mixBotSeed(config.seed, slot.slot));
      // The factory is typed against `AnyGameDefinition`'s command and sim.
      const policy = factory(config, info, rng) as BotPolicy<
        CommandOf<G>,
        SimOf<G>
      >;
      return { slot: slot.slot, rng, policy };
    });
  }

  /** Hosted bot slots, ascending. */
  public get slots(): readonly number[] {
    return this.hosted.map((bot) => bot.slot);
  }

  public decideAll(
    sim: Readonly<SimOf<G>>,
    tick: number
  ): readonly BotDecision<CommandOf<G>>[] {
    const decisions: BotDecision<CommandOf<G>>[] = [];
    for (const bot of this.hosted) {
      decisions.push({
        slot: bot.slot,
        commands: bot.policy.decide(sim, tick),
      });
    }
    return decisions;
  }

  /** Bot state section of a snapshot (outside the digest). */
  public save(writer: StateWriter): void {
    writer.u8(this.sideTag);
    writer.sortedBy(
      this.hosted,
      (bot) => bot.slot,
      (bot, botWriter) => {
        botWriter.varint(bot.slot);
        botWriter.list(bot.rng.getState(), (word, wordWriter) => {
          wordWriter.i32(word);
        });
        if (typeof bot.policy.save === 'function') {
          botWriter.bool(true);
          const nested = new BinaryStateWriter();
          bot.policy.save(nested);
          botWriter.bytes(nested.finish());
        } else {
          botWriter.bool(false);
        }
      }
    );
  }

  public restore(reader: StateReader): void {
    const side = reader.u8();
    const apply = side === this.sideTag;
    const bySlot = new Map(this.hosted.map((bot) => [bot.slot, bot]));
    reader.list((botReader) => {
      const slot = botReader.varint();
      const words = botReader.list((wordReader) => wordReader.i32());
      const hasPolicy = botReader.bool();
      const policyBytes = hasPolicy ? botReader.bytes() : null;
      if (!apply) return 0;
      const bot = bySlot.get(slot);
      if (bot === undefined) return 0;
      if (words.length !== RNG_WORDS) {
        throw new Error(
          `BotHost.restore: expected ${String(RNG_WORDS)} RNG words, got ${String(words.length)}`
        );
      }
      bot.rng.setState(words);
      if (policyBytes !== null && typeof bot.policy.restore === 'function') {
        const nested = new BinaryStateReader(policyBytes);
        bot.policy.restore(nested);
        nested.done();
      }
      return 0;
    });
  }
}

/**
 * Unsigned 32-bit mix of the match seed and the slot. Addition would
 * collide (`seed 5, slot 1` vs `seed 6, slot 0`); this does not.
 */
function mixBotSeed(seed: number, slot: number): number {
  let mixed = (seed >>> 0) ^ Math.imul(slot + 1, 0x9e3779b1);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
