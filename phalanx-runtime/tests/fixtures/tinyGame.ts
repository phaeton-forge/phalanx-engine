import type { GameWorld } from '@phalanx-engine/ecs';
import {
  defineGame,
  rejectCommand,
  type BotPolicy,
  type CommandRejection,
  type GameState,
  type JsonValue,
  type MatchConfigBase,
  type SimWorld,
  type SlotConfig,
  type StampedCommand,
  type StateReader,
  type StateWriter,
} from '../../src/index.js';

export type TinySlot = SlotConfig & { readonly color: number };

export interface TinyConfig extends MatchConfigBase<TinySlot> {
  readonly arenaSize: number;
}

export type TinyCommand =
  { readonly type: 'spawn'; readonly x: bigint } | { readonly type: 'stop' };

export class TinySim implements SimWorld<TinyCommand> {
  public readonly units: { id: number; slot: number; x: bigint }[] = [];
  public lastTick = -1;

  public constructor(
    public readonly world: GameWorld,
    public readonly config: TinyConfig
  ) {}

  public applyCommand(stamped: StampedCommand<TinyCommand>): void {
    this.lastTick = stamped.tick;
    if (stamped.command.type === 'spawn') {
      this.units.push({
        id: this.units.length + 1,
        slot: stamped.slot,
        x: stamped.command.x,
      });
    }
  }
}

export class TinyState implements GameState {
  public constructor(private readonly sim: TinySim) {}

  public save(w: StateWriter): void {
    w.section('units', 1, (s) =>
      s.list(this.sim.units, (u, iw) => {
        iw.u32(u.id);
        iw.u8(u.slot);
        iw.i64(u.x);
      })
    );
  }

  public restore(r: StateReader): void {
    const units = r.section('units', (s) =>
      s.list((ir) => ({ id: ir.u32(), slot: ir.u8(), x: ir.i64() }))
    );
    this.sim.units.length = 0;
    this.sim.units.push(...units);
  }
}

const idleBot: BotPolicy<TinyCommand, TinySim> = {
  decide: () => [],
};

/** Not runnable before Task 6: `createWorld` is never invoked here. */
export const TinyGame = defineGame({
  id: 'tiny',
  simVersion: 'tiny-1',
  tickRate: 10,
  createWorld: (_config: TinyConfig, _ctx): TinySim => {
    throw new Error('TinyGame.createWorld is a type fixture');
  },
  commands: {
    types: ['spawn', 'stop'],
    decode: (raw): TinyCommand | CommandRejection => {
      if (typeof raw !== 'object' || raw === null) {
        return rejectCommand('not an object');
      }
      const value = raw as { type?: unknown; x?: unknown };
      if (value.type === 'stop') return { type: 'stop' };
      if (value.type === 'spawn' && typeof value.x === 'string') {
        return { type: 'spawn', x: BigInt(value.x) };
      }
      return rejectCommand('unknown command');
    },
    validate: (command, _slot, sim) =>
      command.type === 'spawn' && sim.units.length >= 8
        ? rejectCommand('unit cap')
        : null,
    encode: (command): JsonValue =>
      command.type === 'spawn'
        ? { type: 'spawn', x: command.x.toString() }
        : { type: 'stop' },
  },
  state: {
    formatVersion: 1,
    bind: (sim) => new TinyState(sim),
  },
  bots: {
    idle: () => idleBot,
  },
  outcome: (sim) =>
    sim.units.length >= 8
      ? { kind: 'win', winnerTeam: 0, reason: 'cap reached' }
      : null,
});
