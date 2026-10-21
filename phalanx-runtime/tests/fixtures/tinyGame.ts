import {
  Entity,
  GameSystem,
  SoAComponent,
  defineSoASchema,
  type CommandsBatch,
  type IRandom,
  type SoAComponentStore,
  type SystemContext,
} from '@phalanx-engine/ecs';
import type { GameWorld } from '@phalanx-engine/ecs';
import {
  defineCommands,
  defineGame,
  rejectCommand,
  type BotPolicy,
  type BotSlotInfo,
  type MatchConfigBase,
  type SlotConfig,
  type SlotInfo,
  type StampedCommand,
  type StateReader,
  type StateWriter,
} from '../../src/index.js';
import { StateHelpers } from '../../src/advanced/index.js';

const TINY_UNIT_SCHEMA = defineSoASchema(
  {
    slot: 'u32',
    x: 'i64',
    hp: 'i64',
  },
  'TinyUnit'
);

type TinyUnitFields = (typeof TINY_UNIT_SCHEMA)['definition'];

const TINY_UNIT_TYPE = Symbol('TinyUnit');
const INITIAL_HP = 100n;

export type TinySlot = SlotConfig & { readonly color: number };

export interface TinyConfig extends MatchConfigBase<TinySlot> {
  readonly arenaSize: number;
}

export type TinyCommand =
  | { readonly type: 'spawn'; readonly x: bigint }
  | { readonly type: 'move'; readonly dx: bigint };

export interface TinyBotCall {
  readonly tick: number;
  readonly commands: readonly TinyCommand[];
}

/** Every hosted `decide` in this process. Tests reset it between runs. */
export const tinyBotCalls: TinyBotCall[] = [];

let sentryConstructed = 0;
let sentryRestored = 0;

/** Counters for the sentry policy. Reset between tests that construct it. */
export function resetSentryBot(): void {
  sentryConstructed = 0;
  sentryRestored = 0;
}

export function sentryBotCounts(): {
  readonly constructed: number;
  readonly restored: number;
} {
  return { constructed: sentryConstructed, restored: sentryRestored };
}

let restoreBroken = false;
let decodeBoom = false;
let validateBoom = false;
let tickBoom = false;
let botBoom = false;
let createDraw = false;

/** Prototype of the commands object the world saw on the last tick. */
export let tinyCommandsProto: object | null = Object.prototype;

/**
 * `getState()` captured at the start of each `onStart` while
 * {@link setTinyCreateDraw} is on. The first entry is the fresh boot.
 */
export const tinyCreateStates: string[] = [];

/** Test hook: the next `restore` writes state that does not round-trip. */
export function setTinyRestoreBroken(broken: boolean): void {
  restoreBroken = broken;
}

/** Test hook: `decode` throws `decode exploded`. */
export function setTinyDecodeBoom(boom: boolean): void {
  decodeBoom = boom;
}

/** Test hook: `validate` throws `validate exploded`. */
export function setTinyValidateBoom(boom: boolean): void {
  validateBoom = boom;
}

/** Test hook: the decay system throws `tick exploded`. */
export function setTinyTickBoom(boom: boolean): void {
  tickBoom = boom;
}

/** Test hook: the walker `decide` throws `bot exploded`. */
export function setTinyBotBoom(boom: boolean): void {
  botBoom = boom;
}

/**
 * Test hook: `onStart` records the match RNG state, then draws once.
 * Restore must show the seed state again, not the generator the ticks
 * already advanced.
 */
export function setTinyCreateDraw(enabled: boolean): void {
  createDraw = enabled;
}

export function resetTinyBotCalls(): void {
  tinyBotCalls.length = 0;
}

class TinyUnitComponent extends SoAComponent<TinyUnitFields> {
  public readonly type = TINY_UNIT_TYPE;

  public constructor(
    entityId: number,
    values: { slot: number; x: bigint; hp: bigint }
  ) {
    super(TINY_UNIT_SCHEMA, entityId, values);
  }
}

class TinyUnit extends Entity {
  public constructor(id: number, slot: number, x: bigint, hp: bigint) {
    super(id);
    this.addComponent(new TinyUnitComponent(this.id, { slot, x, hp }));
  }
}

class TinyDecaySystem extends GameSystem {
  private store: SoAComponentStore<TinyUnitFields> | null = null;

  public override init(context: SystemContext): void {
    super.init(context);
    this.store = context.entityManager.getSoAStore(TINY_UNIT_SCHEMA) ?? null;
  }

  public beforeTick(_tick: number, commands: CommandsBatch): void {
    tinyCommandsProto = Object.getPrototypeOf(commands.commands) as
      object | null;
  }

  public override processTick(_tick: number): void {
    if (tickBoom) throw new Error('tick exploded');
    // Advance the match RNG so a restore that skips `readRandom` diverges.
    this.random.int(1);
    const store = this.store;
    if (store === null) return;
    const hp = store.arrays.hp;
    for (const id of store.entityIds()) {
      const index = store.indexOf(id);
      if (index < 0) continue;
      const value = hp[index];
      if (value === undefined || value <= 0n) continue;
      hp[index] = value - 1n;
    }
  }
}

export interface TinyUnitView {
  readonly id: number;
  readonly slot: number;
  readonly x: bigint;
  readonly hp: bigint;
}

export class TinySim {
  public constructor(
    public readonly world: GameWorld,
    public readonly random: IRandom,
    public readonly config: TinyConfig
  ) {}

  public apply(stamped: StampedCommand<TinyCommand>): void {
    if (stamped.command.type === 'spawn') {
      const { x } = stamped.command;
      const slot = stamped.slot;
      const unit = this.world.createEntity(
        (id) => new TinyUnit(id, slot, x, INITIAL_HP)
      );
      this.world.entityManager.addEntity(unit);
      return;
    }
    const unit = this.unitBySlot(stamped.slot);
    if (unit === null) return;
    const store = this.store();
    if (store === undefined) return;
    const index = store.indexOf(unit.id);
    const x = store.arrays.x[index];
    if (x === undefined) return;
    store.arrays.x[index] = x + stamped.command.dx;
  }

  public unitBySlot(slot: number): TinyUnitView | null {
    const units = this.units();
    for (const unit of units) {
      if (unit.slot === slot) return unit;
    }
    return null;
  }

  public units(): TinyUnitView[] {
    const store = this.store();
    if (store === undefined) return [];
    const views: TinyUnitView[] = [];
    for (const id of store.entityIds()) {
      const index = store.indexOf(id);
      const slot = store.arrays.slot[index];
      const x = store.arrays.x[index];
      const hp = store.arrays.hp[index];
      if (slot === undefined || x === undefined || hp === undefined) continue;
      views.push({ id, slot, x, hp });
    }
    return views;
  }

  public entityIds(): readonly number[] {
    const store = this.store();
    if (store === undefined) return [];
    return store.entityIds().slice();
  }

  public maxAbsX(): bigint {
    let max = 0n;
    for (const unit of this.units()) {
      const abs = unit.x < 0n ? -unit.x : unit.x;
      if (abs > max) max = abs;
    }
    return max;
  }

  private store(): SoAComponentStore<TinyUnitFields> | undefined {
    return this.world.entityManager.getSoAStore(TINY_UNIT_SCHEMA);
  }
}

export class TinyState {
  public constructor(private readonly sim: TinySim) {}

  public save(w: StateWriter): void {
    const ids = this.sim.entityIds();
    w.section('roster', 1, (section) => {
      section.list(ids, (id, item) => {
        item.u32(id);
      });
    });
    StateHelpers.writePools(w, this.sim.world);
    StateHelpers.writeSoAStores(w, this.sim.world, [TINY_UNIT_SCHEMA]);
    StateHelpers.writeEntityIds(w, this.sim.world);
    StateHelpers.writeRandom(w, this.sim.random);
    StateHelpers.writeModuleSections(w, this.sim.world);
  }

  public restore(r: StateReader): void {
    const ids = r.section('roster', (section) =>
      section.list((item) => item.u32())
    );
    for (const id of ids) {
      StateHelpers.spawnWithId(
        this.sim.world,
        id,
        (entityId) => new TinyUnit(entityId, 0, 0n, 0n)
      );
    }
    StateHelpers.readPools(r, this.sim.world);
    StateHelpers.readSoAStores(r, this.sim.world, [TINY_UNIT_SCHEMA]);
    StateHelpers.readEntityIds(r, this.sim.world);
    StateHelpers.readRandom(r, this.sim.random);
    StateHelpers.readModuleSections(r, this.sim.world);
    if (restoreBroken) this.corrupt();
  }

  private corrupt(): void {
    const store = this.sim.world.entityManager.getSoAStore(TINY_UNIT_SCHEMA);
    const first = store?.entityIds()[0];
    if (store !== undefined && first !== undefined) {
      const index = store.indexOf(first);
      const x = store.arrays.x[index];
      if (x !== undefined) {
        store.arrays.x[index] = x + 1n;
        return;
      }
    }
    this.sim.world.entityManager.allocateEntityId();
  }
}

class WalkerBot implements BotPolicy<TinyCommand, TinySim> {
  private decisions = 0;

  public constructor(
    private readonly slot: number,
    private readonly rng: IRandom
  ) {}

  public decide(sim: Readonly<TinySim>, tick: number): readonly TinyCommand[] {
    if (botBoom) throw new Error('bot exploded');
    this.decisions += 1;
    const roll = this.rng.int(3);
    const dx = BigInt(roll + 1 + this.decisions);
    const commands: TinyCommand[] = sim.unitBySlot(this.slot)
      ? [{ type: 'move', dx }]
      : [{ type: 'spawn', x: dx }];
    tinyBotCalls.push({ tick, commands });
    return commands;
  }

  public save(w: StateWriter): void {
    w.u32(this.decisions);
  }

  public restore(r: StateReader): void {
    this.decisions = r.u32();
  }
}

/** Second policy. Save bytes are one mark byte, not the walker's `u32`. */
class SentryBot implements BotPolicy<TinyCommand, TinySim> {
  public constructor() {
    sentryConstructed += 1;
  }

  public decide(
    _sim: Readonly<TinySim>,
    _tick: number
  ): readonly TinyCommand[] {
    return [{ type: 'spawn', x: 42n }];
  }

  public save(w: StateWriter): void {
    w.u8(7);
  }

  public restore(r: StateReader): void {
    sentryRestored += 1;
    const mark = r.u8();
    if (mark !== 7) {
      throw new Error(
        `SentryBot.restore: expected mark 7, got ${String(mark)}`
      );
    }
  }
}

const codec = defineCommands(
  {
    spawn: { x: 'i64' },
    move: { dx: 'i64' },
  },
  {
    validate(command, slot, sim) {
      if (validateBoom) throw new Error('validate exploded');
      const existing = (sim as TinySim).unitBySlot(slot.slot);
      if (command.type === 'spawn') {
        return existing ? rejectCommand('slot occupied') : null;
      }
      return existing ? null : rejectCommand('no unit');
    },
  }
);

const commands = {
  ...codec,
  decode(raw: unknown, slot: SlotInfo) {
    if (decodeBoom) throw new Error('decode exploded');
    return codec.decode(raw, slot);
  },
};

/**
 * Two-slot fixture: i64 position and hp on a named SoA schema, `spawn` /
 * `move` commands, and a walker bot. The save handler uses the Task 4
 * helpers (pools, SoA, entity ids, RNG). There is no GAS and no physics.
 */
export const TinyGame = defineGame<TinyConfig, TinyCommand, TinySim>({
  id: 'tiny',
  simVersion: 'tiny-1',
  tickRate: 10,
  commands,
  systems: [() => new TinyDecaySystem()],
  onStart: (ctx) => {
    if (createDraw && hasGeneratorState(ctx.rng)) {
      tinyCreateStates.push(ctx.rng.getState().join(','));
      ctx.rng.int(1_000_000);
    }
    ctx.world.entityManager.getOrCreateSoAStore(TINY_UNIT_SCHEMA);
    const sim = new TinySim(ctx.world, ctx.rng, ctx.config);
    ctx.open();
    return sim;
  },
  onCommand: (ctx, stamped) => {
    ctx.sim.apply(stamped);
  },
  save: {
    formatVersion: 1,
    handler: (sim) => new TinyState(sim),
  },
  bots: {
    walker: (_config, slot: BotSlotInfo, rng: IRandom) =>
      new WalkerBot(slot.slot, rng),
    sentry: () => new SentryBot(),
  },
  checkOutcome: (sim) =>
    sim.maxAbsX() >= BigInt(sim.config.arenaSize)
      ? { kind: 'win', winnerTeam: 0, reason: 'arena' }
      : null,
});

function hasGeneratorState(
  rng: IRandom
): rng is IRandom & { getState(): readonly number[] } {
  if (!('getState' in rng)) return false;
  const candidate: unknown = rng.getState;
  return typeof candidate === 'function';
}
