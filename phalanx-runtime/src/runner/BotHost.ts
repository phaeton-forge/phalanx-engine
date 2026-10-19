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
import { botPlayerId } from '@phalanx-engine/protocol';
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
const MODE_HUMAN = 0;
const MODE_BOT = 1;
const RNG_WORDS = 4;

/**
 * Instantiates the policies of the bot slots hosted on `side` (one
 * `DeterministicRandom` per slot, seeded from `(config.seed, slot)`) and
 * collects their decisions after each tick, slot ascending.
 *
 * Saved bytes start with the hosting side, then every slot's controller
 * mode, then the hosted policies. Modes are outside the digest and are
 * applied on every peer. Policy and RNG bytes are applied only when the
 * side matches and this host runs the slot. A client restoring a server
 * snapshot therefore keeps a human-to-bot handover without taking on the
 * server's policy state.
 *
 * An existing bot is reused only when policy, level, and `runsOn` match
 * the saved record. Otherwise a new policy is constructed and the saved
 * bytes are restored into that instance.
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
  private readonly modeMap: Map<number, 'human' | 'bot'> | null;

  public constructor(
    definition: G,
    config: ConfigOf<G>,
    side: RunnerSide,
    modes?: Map<number, 'human' | 'bot'>
  ) {
    this.definition = definition;
    this.config = config;
    this.side = side;
    this.modeMap = modes ?? null;
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
      this.config.slots,
      (slot) => slot.slot,
      (slot, modeWriter) => {
        modeWriter.varint(slot.slot);
        const mode = this.modeMap?.get(slot.slot) ?? slot.kind;
        modeWriter.u8(mode === 'bot' ? MODE_BOT : MODE_HUMAN);
      }
    );
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
    this.readModes(reader);
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
      const runsOn: BotHostSide = record.runsOn;
      if (!this.hostsRunsOn(runsOn)) continue;
      const existing = this.hosted.find((bot) => bot.slot === record.slot);
      const reusable =
        existing !== undefined &&
        existing.policyName === record.policyName &&
        existing.level === record.level &&
        existing.runsOn === runsOn;
      const bot = reusable
        ? existing
        : this.createBot({
            slot: record.slot,
            team: this.teamOf(record.slot),
            policy: record.policyName,
            level: record.level,
            runsOn,
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

  /**
   * Every slot's controller mode. Applied even when the snapshot was
   * written by the other side; policy bytes stay behind that gate.
   */
  private readModes(reader: StateReader): void {
    const rows = reader.list((modeReader) => {
      const slot = modeReader.varint();
      const flag = modeReader.u8();
      return { slot, flag };
    });
    if (this.modeMap === null) return;
    const seen = new Set<number>();
    for (const row of rows) {
      if (!Number.isInteger(row.slot) || row.slot < 0) {
        throw new Error(
          `BotHost.restore: controller mode slot ${String(row.slot)} is invalid`
        );
      }
      if (seen.has(row.slot)) {
        throw new Error(
          `BotHost.restore: duplicate controller mode for slot ${String(row.slot)}`
        );
      }
      seen.add(row.slot);
      if (row.flag !== MODE_HUMAN && row.flag !== MODE_BOT) {
        throw new Error(
          `BotHost.restore: mode ${String(row.flag)} is not human or bot`
        );
      }
      if (this.config.slots[row.slot] === undefined) {
        throw new Error(`BotHost.restore: unknown slot ${String(row.slot)}`);
      }
      this.modeMap.set(row.slot, row.flag === MODE_BOT ? 'bot' : 'human');
    }
    for (const slot of this.config.slots) {
      if (!seen.has(slot.slot)) {
        throw new Error(
          `BotHost.restore: missing controller mode for slot ${String(slot.slot)}`
        );
      }
    }
  }

  private teamOf(slot: number): number {
    const config = this.config.slots[slot];
    return config === undefined ? 0 : config.team;
  }
}
