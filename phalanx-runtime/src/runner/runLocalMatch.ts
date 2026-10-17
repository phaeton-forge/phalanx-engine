import type { AnyGameDefinition } from '../game/GameDefinition.js';
import type { BotHostSide, SimMode, SlotConfig } from '../game/MatchConfig.js';
import type { MatchStore } from '../persistence/MatchStore.js';
import { LocalTransport } from '../transport/LocalTransport.js';
import { MatchRunner, type ConfigInput } from './MatchRunner.js';

/** A human seat. `slot` defaults to the array index. */
export interface LocalHumanSlot {
  readonly kind: 'human';
  readonly slot?: number;
  readonly team?: number;
  readonly playerId?: string;
}

/** A bot seat. `policy` is a key of `GameDefinition.bots`. */
export interface LocalBotSlot {
  readonly kind: 'bot';
  readonly policy: string;
  readonly slot?: number;
  readonly team?: number;
  readonly level?: number;
  readonly runsOn?: BotHostSide;
}

export type LocalSlot = LocalHumanSlot | LocalBotSlot;

export interface RunLocalMatchOptions {
  readonly seed: number;
  readonly slots: readonly LocalSlot[];
  /** When true, advance with {@link LocalMatch.step}. Default: a clock. */
  readonly stepped?: boolean;
  /** Default {@link DEFAULT_INPUT_DELAY_TICKS} inside the runner. */
  readonly inputDelayTicks?: number;
  /** Default `'client'`. */
  readonly side?: SimMode;
  /** Default `'local'`. */
  readonly matchId?: string;
  /** Opt-in command and snapshot journal. Omitted: no persistence. */
  readonly store?: MatchStore;
  /** Default 300. Ignored unless `store` is set. */
  readonly snapshotEveryTicks?: number;
  /** Default `true`. A host with no document ignores it. */
  readonly pauseWhenHidden?: boolean;
}

export interface LocalMatch<G extends AnyGameDefinition> {
  readonly runner: MatchRunner<G>;
  readonly transport: LocalTransport;
  /** Advance a stepped match. Throws when the transport is clocked. */
  step(count?: number): void;
}

/**
 * Build a local config from short slots, start the runner, and return it
 * with its transport. `gameId` and `simVersion` come from the definition.
 */
export function runLocalMatch<G extends AnyGameDefinition>(
  definition: G,
  options: RunLocalMatchOptions
): LocalMatch<G> {
  const side = options.side ?? 'client';
  const slots = options.slots.map((slot, index) =>
    expandSlot(slot, index, side)
  );
  const transport = createTransport(definition.tickRate, options);
  const runner = new MatchRunner(
    definition,
    {
      seed: options.seed,
      side,
      slots,
      ...(options.matchId === undefined ? {} : { matchId: options.matchId }),
      ...(options.inputDelayTicks === undefined
        ? {}
        : { inputDelayTicks: options.inputDelayTicks }),
      // Short slots expand to the base slot shape. A game that adds required
      // slot fields uses MatchRunner directly.
    } as unknown as ConfigInput<G>,
    transport
  );
  runner.start();
  return {
    runner,
    transport,
    step(count = 1): void {
      if (!transport.isStepped) {
        throw new Error('runLocalMatch: step() requires stepped: true');
      }
      transport.step(count);
    },
  };
}

function createTransport(
  tickRate: number,
  options: RunLocalMatchOptions
): LocalTransport {
  const persist =
    options.store !== undefined ||
    options.snapshotEveryTicks !== undefined ||
    options.pauseWhenHidden !== undefined;
  if (!persist) {
    return options.stepped === true
      ? LocalTransport.stepped()
      : new LocalTransport({ tickRate });
  }
  return new LocalTransport(
    {
      tickRate: options.stepped === true ? 1 : tickRate,
      ...(options.store === undefined ? {} : { store: options.store }),
      ...(options.snapshotEveryTicks === undefined
        ? {}
        : { snapshotEveryTicks: options.snapshotEveryTicks }),
      ...(options.pauseWhenHidden === undefined
        ? {}
        : { pauseWhenHidden: options.pauseWhenHidden }),
    },
    options.stepped === true
  );
}

function expandSlot(slot: LocalSlot, index: number, side: SimMode): SlotConfig {
  if (slot.slot !== undefined && slot.slot !== index) {
    throw new Error(
      `runLocalMatch: slot ${String(slot.slot)} must equal index ${String(index)}`
    );
  }
  const team = slot.team ?? 0;
  if (slot.kind === 'human') {
    return {
      slot: index,
      team,
      kind: 'human',
      playerId: slot.playerId ?? `local:${String(index)}`,
    };
  }
  return {
    slot: index,
    team,
    kind: 'bot',
    policy: slot.policy,
    level: slot.level ?? 0,
    runsOn: slot.runsOn ?? (side === 'server' ? 'server' : 'local'),
  };
}
