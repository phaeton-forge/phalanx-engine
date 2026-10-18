import { GameSystem, type GameWorld } from '@phalanx-engine/ecs';
import {
  defineCommands,
  defineGame,
  type BotPolicy,
  type MatchConfigBase,
  type StateReader,
  type StateWriter,
} from '@phalanx-engine/runtime';

/**
 * Tiny lockstep fixture for SimHost tests. Integer knobs are part of the
 * match config so both peers hash the same object. `0` means the knob is off.
 * Wall-clock spinning and `process.exit` exist only to exercise the relay;
 * they do not change `x`.
 */
export interface RelayConfig extends MatchConfigBase {
  readonly throwAt?: number;
  readonly exitAt?: number;
  readonly blockMs?: number;
  readonly allocMb?: number;
  readonly winAt?: number;
}

export interface RelaySim {
  readonly world: GameWorld;
  x: number;
  tick: number;
  readonly config: RelayConfig;
}

const commands = defineCommands({
  move: { dx: 'i32' },
});

type RelayCommand = { readonly type: 'move'; readonly dx: number };

function knob(value: number | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0;
}

class RelayHooks extends GameSystem {
  private readonly config: RelayConfig;
  private readonly sim: RelaySim;
  private readonly retained: Uint8Array[] = [];

  public constructor(config: RelayConfig, sim: RelaySim) {
    super();
    this.config = config;
    this.sim = sim;
  }

  public override processTick(tick: number): void {
    this.sim.tick = tick;
    const throwAt = knob(this.config.throwAt);
    if (throwAt > 0 && tick === throwAt) {
      throw new Error('relay fixture throw');
    }
    const exitAt = knob(this.config.exitAt);
    if (exitAt > 0 && tick === exitAt) {
      if (process.env['PHALANX_SIM_WORKER'] === '1') {
        process.exit(1);
      }
      const error = new Error('process.exit(1)');
      error.name = 'SimCrashError';
      throw error;
    }
    const allocMb = knob(this.config.allocMb);
    if (allocMb > 0 && tick === 1) {
      const chunkBytes = 1024 * 1024;
      const target = allocMb * chunkBytes;
      let allocated = 0;
      try {
        while (allocated < target) {
          const chunk = new Uint8Array(chunkBytes);
          chunk[0] = 1;
          this.retained.push(chunk);
          allocated += chunk.byteLength;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        throw new Error(
          `out of memory: ${message.length > 0 ? message : 'allocation failed'}`
        );
      }
      throw new Error('out of memory');
    }
    const blockMs = knob(this.config.blockMs);
    if (blockMs > 0) {
      const start = performance.now();
      while (performance.now() - start < blockMs) {
        // Hold the worker thread. The relay clock must keep running.
      }
    }
  }
}

let booting: RelayConfig | null = null;
let bootingSim: RelaySim | null = null;

export const RelayGame = defineGame<RelayConfig, RelayCommand, RelaySim>({
  id: 'relay-fixture',
  simVersion: 'relay-1',
  tickRate: 64,
  commands,
  systems: [
    () => {
      if (booting === null || bootingSim === null) {
        throw new Error('relay fixture system built outside onStart');
      }
      return new RelayHooks(booting, bootingSim);
    },
  ],
  onStart(ctx) {
    const sim: RelaySim = {
      world: ctx.world,
      x: 0,
      tick: -1,
      config: ctx.config,
    };
    booting = ctx.config;
    bootingSim = sim;
    ctx.open();
    booting = null;
    bootingSim = null;
    return sim;
  },
  onCommand(ctx, stamped) {
    if (stamped.command.type !== 'move') return;
    ctx.sim.x += stamped.command.dx;
  },
  checkOutcome(sim) {
    const winAt = knob(sim.config.winAt);
    if (winAt > 0 && sim.tick === winAt) {
      return { kind: 'win', winnerTeam: 0, reason: 'fixture-win' };
    }
    return null;
  },
  bots: {
    walker: (): BotPolicy<RelayCommand, RelaySim> => ({
      decide() {
        return [{ type: 'move', dx: 1 }];
      },
    }),
  },
  save: {
    formatVersion: 1,
    handler(sim) {
      return {
        save(w: StateWriter): void {
          w.section('x', 1, (section) => {
            section.i32(sim.x);
          });
        },
        restore(r: StateReader): void {
          sim.x = r.section('x', (section) => section.i32());
        },
      };
    },
  },
});
