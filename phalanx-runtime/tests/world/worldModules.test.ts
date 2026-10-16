import { afterEach, describe, expect, it } from 'vitest';
import { Entity, GameWorld, type IPoolableEntity } from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import { PhysicsSoASchema, TransformSoASchema } from '@phalanx-engine/physics';
import {
  LocalTransport,
  MatchRunner,
  BinaryStateWriter,
  configHash,
  decodeSnapshot,
  defineComponent,
  defineGame,
  type DefinedComponent,
  type MatchConfigBase,
} from '../../src/index.js';
import { StateHelpers } from '../../src/advanced/index.js';
import {
  ArenaGame,
  type ArenaConfig,
  type ArenaSim,
} from '../fixtures/arenaGame.js';
import { TinyGame, TinyState, type TinyConfig } from '../fixtures/tinyGame.js';

const LAST_TICK = 377;
const TICKS = [3, 59, 200, LAST_TICK] as const;

describe('world modules', () => {
  const live: { dispose(): void }[] = [];

  afterEach(() => {
    while (live.length > 0) live.pop()?.dispose();
  });

  it('matches a manual StateHelpers save for tiny and arena', () => {
    const tinySaved = captureTiny();
    for (const tick of TICKS) {
      const saved = tinySaved.get(tick);
      expect(saved, `tiny tick ${String(tick)}`).toBeDefined();
      expect(saved?.auto).toEqual(saved?.manual);
    }

    const arenaSaved = captureArena();
    for (const tick of TICKS) {
      const saved = arenaSaved.get(tick);
      expect(saved, `arena tick ${String(tick)}`).toBeDefined();
      expect(saved?.auto).toEqual(saved?.manual);
    }
  });

  it('folds component registration order into configHash', () => {
    expect(configHash({ seed: 1 }, [])).toBe(configHash({ seed: 1 }));
    expect(configHash({ seed: 1 }, ['Unit', 'Health'])).not.toBe(
      configHash({ seed: 1 }, ['Health', 'Unit'])
    );
    expect(configHash({ seed: 1 }, ['Unit'])).not.toBe(configHash({ seed: 1 }));

    const marker = defineComponent('Marker', { n: 'u8' });
    const game = defineGame({
      id: 'hash',
      simVersion: 'hash-1',
      tickRate: 10,
      createWorld: (_config, ctx) => {
        const world = new GameWorld({
          tickFrameProvider: ctx.tickFrameProvider,
          random: ctx.random,
          tickRate: 10,
        });
        world.registerComponent(marker);
        world.registerSystems([], []);
        world.start();
        return { world, applyCommand() {} };
      },
      commands: {
        types: ['noop'],
        decode: () => ({ type: 'noop' }),
      },
      outcome: () => null,
    });
    const config = hashConfig();
    const transport = LocalTransport.manual();
    const runner = new MatchRunner(game, config, transport);
    live.push(runner);
    runner.start();
    transport.step(1);
    const header = decodeSnapshot(runner.snapshot()).header;
    expect(header.configHash).toBe(configHash(config, ['Marker']));
    expect(header.configHash).not.toBe(configHash(config));
  });

  it('rejects float fields and reserved section names', () => {
    expect(() => defineComponent('Floaty', { x: 'f32' })).toThrow(/f32/);
    expect(() => defineComponent('Floaty', { x: 'f64' })).toThrow(/f64/);
    expect(() => defineComponent('gas', { n: 'u8' })).toThrow(/reserved/);
  });

  it('skips roster ids that world creation already spawned', () => {
    let enables = 0;
    const unit = defineComponent(
      'Unit',
      { hp: 'i64' },
      {
        defaults: { hp: 10n },
        onEnable() {
          enables += 1;
        },
      }
    );
    const source = openWorld(unit);
    live.push(source);
    const spawned = source.spawn({ Unit: { hp: 4n } });
    source.each(unit, (row) => {
      row.hp = 3n;
    });
    const bytes = source.save();
    expect(spawned.id).toBe(1);

    enables = 0;
    const restored = openWorld(unit);
    live.push(restored);
    restored.spawn({ Unit: { hp: 10n } });
    expect(enables).toBe(1);
    expect(() => restored.restore(bytes)).not.toThrow();
    expect(enables).toBe(2);
    let hp = 0n;
    restored.each(unit, (row) => {
      hp = row.hp;
    });
    expect(hp).toBe(3n);
  });

  it('resets pooled SoA fields to schema defaults across three lives', () => {
    const unit = defineComponent(
      'Hp',
      { hp: 'i64' },
      { defaults: { hp: 48n } }
    );
    class Pawn extends Entity implements IPoolableEntity {
      public constructor() {
        super();
        this.addComponent(unit.create(this.id));
      }

      public onSpawn(_args: void): void {}

      public onDespawn(): void {}
    }
    const world = new GameWorld({
      tickFrameProvider: silentProvider(),
      pooling: {
        entityTypes: {
          pawn: { factory: () => new Pawn() },
        },
      },
    });
    live.push(world);
    world.registerComponent(unit);
    const pools = world.pools;
    if (pools === null) throw new Error('expected pools');
    const fresh = pools.spawn<Pawn>('pawn');
    const recycled = pools.spawn<Pawn>('pawn');
    for (let life = 0; life < 3; life += 1) {
      setHp(world, unit, recycled.id, 32n);
      expect(hpOf(world, unit, recycled.id)).toBe(32n);
      pools.despawn(recycled);
      const again = pools.spawn<Pawn>('pawn');
      expect(again.id).toBe(recycled.id);
      expect(hpOf(world, unit, recycled.id)).toBe(48n);
      expect(hpOf(world, unit, fresh.id)).toBe(48n);
    }
  });

  it('continues a default-state world after restore', async () => {
    const unit = defineComponent('Pos', { x: 'i64' }, { defaults: { x: 0n } });
    const game = defineGame({
      id: 'continue',
      simVersion: 'continue-1',
      tickRate: 10,
      createWorld: (_config, ctx) => {
        const world = new GameWorld({
          tickFrameProvider: ctx.tickFrameProvider,
          random: ctx.random,
          tickRate: 10,
        });
        world.registerComponent(unit);
        if (ctx.purpose === 'fresh') world.spawn({ Pos: { x: 1n } });
        world.registerSystems([], []);
        world.start();
        return {
          world,
          applyCommand() {
            world.each(unit, (row) => {
              row.x += 1n;
            });
          },
        };
      },
      commands: {
        types: ['step'],
        decode: () => ({ type: 'step' }),
        encode: () => ({ type: 'step' }),
      },
      outcome: () => null,
    });
    const config = continueConfig();
    const transport = LocalTransport.manual();
    const runner = new MatchRunner(game, config, transport, {
      hashEveryTicks: 1,
    });
    live.push(runner);
    const digests: string[] = [];
    runner.onDigest((tick, digest) => {
      digests[tick] = digest;
    });
    runner.start();
    runner.submit({ type: 'step' });
    transport.step(SNAPSHOT_TICK + 1);
    const snapshot = runner.snapshot();
    const atSnapshot = runner.digest();
    transport.step(THROUGH - SNAPSHOT_TICK);
    expect(runner.tick).toBe(THROUGH);

    const tail = runner.log
      .entriesAfter(SNAPSHOT_TICK)
      .filter((entry) => entry.tick <= THROUGH);
    const copyTransport = LocalTransport.manual();
    const copy = new MatchRunner(game, config, copyTransport, {
      hashEveryTicks: 1,
    });
    live.push(copy);
    const copyDigests: string[] = [];
    copy.onDigest((tick, digest) => {
      copyDigests[tick] = digest;
    });
    copy.restore(snapshot);
    expect(copy.tick).toBe(SNAPSHOT_TICK);
    expect(copy.digest()).toBe(atSnapshot);
    expect(copy.digest()).toBe(digests[SNAPSHOT_TICK]);
    await copy.fastForward(tail, {
      budgetMs: 1000,
      throughTick: THROUGH,
    });
    expect(copy.tick).toBe(THROUGH);
    expect(copy.digest()).toBe(runner.digest());
    expect(copy.digest()).toBe(digests[THROUGH]);
    for (let tick = SNAPSHOT_TICK + 1; tick <= THROUGH; tick += 1) {
      expect(copyDigests[tick]).toBe(digests[tick]);
    }
  });
});

const SNAPSHOT_TICK = 3;
const THROUGH = 7;

function setHp(
  world: GameWorld,
  unit: DefinedComponent<{ hp: 'i64' }>,
  entityId: number,
  hp: bigint
): void {
  let seen = -1;
  world.each(unit, (row) => {
    seen += 1;
    const ids = world.entityManager.getSoAStore(unit.schema)?.entityIds();
    if (ids?.[seen] === entityId) row.hp = hp;
  });
}

function hpOf(
  world: GameWorld,
  unit: DefinedComponent<{ hp: 'i64' }>,
  entityId: number
): bigint {
  let value: bigint | undefined;
  let seen = -1;
  world.each(unit, (row) => {
    seen += 1;
    const ids = world.entityManager.getSoAStore(unit.schema)?.entityIds();
    if (ids?.[seen] === entityId) value = row.hp;
  });
  if (value === undefined) throw new Error('missing hp');
  return value;
}

function silentProvider() {
  return {
    onTick: () => () => {},
    onFrame: () => () => {},
  };
}

function openWorld(component: DefinedComponent<{ hp: 'i64' }>): GameWorld {
  const world = new GameWorld({
    random: new DeterministicRandom(1),
    tickRate: 10,
    tickFrameProvider: silentProvider(),
  });
  world.registerComponent(component);
  return world;
}

function captureTiny(): Map<number, { auto: Uint8Array; manual: Uint8Array }> {
  const transport = LocalTransport.manual();
  const runner = new MatchRunner(TinyGame, tinyConfig(), transport);
  const saved = new Map<number, { auto: Uint8Array; manual: Uint8Array }>();
  runner.onTick((tick) => {
    if (!isSample(tick)) return;
    const sim = runner.sim;
    const writer = new BinaryStateWriter();
    new TinyState(sim).save(writer);
    saved.set(tick, { auto: sim.world.save(), manual: writer.finish() });
  });
  runner.start();
  transport.step(LAST_TICK + 1);
  runner.dispose();
  return saved;
}

function captureArena(): Map<number, { auto: Uint8Array; manual: Uint8Array }> {
  const transport = LocalTransport.manual();
  const runner = new MatchRunner(ArenaGame, arenaConfig(), transport);
  const saved = new Map<number, { auto: Uint8Array; manual: Uint8Array }>();
  runner.onTick((tick) => {
    if (!isSample(tick)) return;
    const sim = runner.sim;
    saved.set(tick, {
      auto: sim.world.save(),
      manual: manualArena(sim),
    });
  });
  runner.start();
  transport.step(LAST_TICK + 1);
  runner.dispose();
  return saved;
}

function manualArena(sim: ArenaSim): Uint8Array {
  const writer = new BinaryStateWriter();
  StateHelpers.writePools(writer, sim.world);
  StateHelpers.writeSoAStores(writer, sim.world, [
    TransformSoASchema,
    PhysicsSoASchema,
  ]);
  StateHelpers.writeAbilities(writer, sim.world);
  StateHelpers.writeEntityIds(writer, sim.world);
  StateHelpers.writeRandom(writer, sim.random);
  StateHelpers.writeBroadphase(writer, sim.world);
  return writer.finish();
}

function isSample(tick: number): boolean {
  return (TICKS as readonly number[]).includes(tick);
}

function tinyConfig(): TinyConfig {
  return {
    matchId: 'tiny-world',
    gameId: 'tiny',
    simVersion: 'tiny-1',
    seed: 7,
    simMode: 'client',
    inputDelayTicks: 2,
    arenaSize: 2_000_000_000,
    slots: [
      { slot: 0, team: 0, kind: 'human', playerId: 'local:0', color: 1 },
      {
        slot: 1,
        team: 1,
        kind: 'bot',
        policy: 'walker',
        level: 1,
        runsOn: 'local',
        color: 2,
      },
    ],
  };
}

function arenaConfig(): ArenaConfig {
  return {
    matchId: 'arena-world',
    gameId: 'arena',
    simVersion: 'arena-1',
    seed: 11,
    simMode: 'client',
    inputDelayTicks: 2,
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
  };
}

function continueConfig(): MatchConfigBase {
  return {
    matchId: 'm',
    gameId: 'continue',
    simVersion: 'continue-1',
    seed: 1,
    simMode: 'client',
    inputDelayTicks: 2,
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
  };
}

function hashConfig(): MatchConfigBase {
  return {
    matchId: 'm',
    gameId: 'hash',
    simVersion: 'hash-1',
    seed: 1,
    simMode: 'client',
    inputDelayTicks: 2,
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
  };
}
