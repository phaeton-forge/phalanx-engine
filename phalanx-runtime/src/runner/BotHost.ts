import { DeterministicRandom } from '@phalanx-engine/math';
import type { GameCommand } from '../game/commands.js';
import type {
  AnyGameDefinition,
  CommandOf,
  ConfigOf,
  SimOf,
} from '../game/GameDefinition.js';
import type {
  BotHostSide,
  BotSlotConfig,
  BotSlotInfo,
} from '../game/MatchConfig.js';
import { botPlayerId } from '../constants.js';
import { BinaryStateReader, BinaryStateWriter } from '../state/BinaryState.js';
import type { StateReader, StateWriter } from '../state/StateIO.js';
import { botSlotSeed } from './botSeed.js';
import type { BotPolicy } from './BotPolicy.js';
import type { RunnerSide } from './MatchRunner.js';

export interface BotDecision<Cmd extends GameCommand = GameCommand> {
  readonly slot: number;
  readonly commands: readonly Cmd[];
}

interface HostedBot<G extends AnyGameDefinition> {
  readonly slot: number;
  readonly team: number;
  readonly policyName: string;
  readonly level: number;
  readonly runsOn: BotHostSide;
  readonly rng: DeterministicRandom;
  readonly policy: BotPolicy<CommandOf<G>, SimOf<G>>;
}

export interface BotAdopt {
  readonly slot: number;
  readonly team: number;
  readonly policy: string;
  readonly level: number;
  readonly runsOn: BotHostSide;
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
 *
 * `decide` is not simulation code. If it throws, the error is reported
 * and that slot submits nothing for the tick. The match keeps running.
 * Policy state may already have changed; treat a throw as a policy bug.
 */
export class BotHost<G extends AnyGameDefinition> {
  private hosted: HostedBot<G>[];
  private readonly sideTag: number;
  private readonly definition: G;
  private readonly config: ConfigOf<G>;
  private readonly side: RunnerSide;

  public constructor(definition: G, config: ConfigOf<G>, side: RunnerSide) {
    this.definition = definition;
    this.config = config;
    this.side = side;
    this.sideTag = side === 'server' ? SERVER_SIDE : CLIENT_SIDE;
    const slots = config.slots
      .filter((slot): slot is BotSlotConfig => {
        if (slot.kind !== 'bot') return false;
        return this.hostsRunsOn(slot.runsOn);
      })
      .slice()
      .sort((a, b) => a.slot - b.slot);

    this.hosted = slots.map((slot) =>
      this.createBot({
        slot: slot.slot,
        team: slot.team,
        policy: slot.policy,
        level: slot.level,
        runsOn: slot.runsOn,
      })
    );
  }

  /** True when this runner executes policies with `runsOn`. */
  public hostsRunsOn(runsOn: BotHostSide): boolean {
    return this.side === 'server' ? runsOn === 'server' : runsOn === 'local';
  }

  public has(slot: number): boolean {
    return this.hosted.some((bot) => bot.slot === slot);
  }

  /**
   * Create the slot's bot and seed its RNG from {@link botSlotSeed}.
   * Replaces a bot that was already hosted on the slot.
   */
  public adopt(spec: BotAdopt): void {
    if (!this.hostsRunsOn(spec.runsOn)) return;
    this.hosted = this.hosted.filter((bot) => bot.slot !== spec.slot);
    this.hosted.push(this.createBot(spec));
    this.hosted.sort((left, right) => left.slot - right.slot);
  }

  /** Drop the slot's bot. Its policy state is discarded. */
  public release(slot: number): void {
    this.hosted = this.hosted.filter((bot) => bot.slot !== slot);
  }

  private createBot(spec: BotAdopt): HostedBot<G> {
    const policies = this.definition.bots;
    const factory = policies?.[spec.policy];
    if (factory === undefined) {
      throw new Error(
        `BotHost: no policy '${spec.policy}' for slot ${String(spec.slot)}`
      );
    }
    const info: BotSlotInfo = {
      slot: spec.slot,
      team: spec.team,
      kind: 'bot',
      playerId: botPlayerId(spec.slot),
      policy: spec.policy,
      level: spec.level,
    };
    const rng = new DeterministicRandom(
      botSlotSeed(this.config.seed, spec.slot)
    );
    const policy = factory(this.config, info, rng) as BotPolicy<
      CommandOf<G>,
      SimOf<G>
    >;
    return {
      slot: spec.slot,
      team: spec.team,
      policyName: spec.policy,
      level: spec.level,
      runsOn: spec.runsOn,
      rng,
      policy,
    };
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
      let commands: readonly CommandOf<G>[] = [];
      try {
        commands = bot.policy.decide(sim, tick);
      } catch (error) {
        console.error(
          `BotHost: decide failed for slot ${String(bot.slot)} at tick ${String(tick)}`,
          error
        );
      }
      decisions.push({ slot: bot.slot, commands });
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
        botWriter.str(bot.policyName);
        botWriter.varint(bot.level);
        botWriter.str(bot.runsOn);
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
    const records = reader.list((botReader) => {
      const slot = botReader.varint();
      const policyName = botReader.str();
      const level = botReader.varint();
      const runsOn = botReader.str();
      const words = botReader.list((wordReader) => wordReader.i32());
      const hasPolicy = botReader.bool();
      const policyBytes = hasPolicy ? botReader.bytes() : null;
      return { slot, policyName, level, runsOn, words, policyBytes };
    });
    if (!apply) return;
    const next: HostedBot<G>[] = [];
    for (const record of records) {
      if (record.runsOn !== 'local' && record.runsOn !== 'server') {
        throw new Error(
          `BotHost.restore: runsOn '${record.runsOn}' is not local or server`
        );
      }
      if (!this.hostsRunsOn(record.runsOn)) continue;
      const existing = this.hosted.find((bot) => bot.slot === record.slot);
      const bot =
        existing ??
        this.createBot({
          slot: record.slot,
          team: this.teamOf(record.slot),
          policy: record.policyName,
          level: record.level,
          runsOn: record.runsOn,
        });
      if (record.words.length !== RNG_WORDS) {
        throw new Error(
          `BotHost.restore: expected ${String(RNG_WORDS)} RNG words, got ${String(record.words.length)}`
        );
      }
      bot.rng.setState(record.words);
      if (
        record.policyBytes !== null &&
        typeof bot.policy.restore === 'function'
      ) {
        const nested = new BinaryStateReader(record.policyBytes);
        bot.policy.restore(nested);
        nested.done();
      }
      next.push(bot);
    }
    next.sort((left, right) => left.slot - right.slot);
    this.hosted = next;
  }

  private teamOf(slot: number): number {
    const config = this.config.slots[slot];
    return config === undefined ? 0 : config.team;
  }
}
