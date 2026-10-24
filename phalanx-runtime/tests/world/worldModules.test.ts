import { afterEach, describe, expect, it } from 'vitest';
import {
  Entity,
  GameWorld,
  type IPoolableEntity,
  type SoaComponentDef,
  type SoASchemaDefinition,
} from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import { PhysicsSoASchema, TransformSoASchema } from '@phalanx-engine/physics';
import {
  LocalTransport,
  MatchRunner,
  BinaryStateWriter,
  configHash,
  decodeSnapshot,
  defineComponent,
  defineCommands,
  defineGame,
  despawn,
  each,
  restoreWorld,
  saveWorld,
  spawn,
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

  it('folds component fields and registration order into configHash', () => {
    const unit = [{ name: 'Unit', fields: [['hp', 'i64']] as const }];
    const health = [{ name: 'Health', fields: [['hp', 'i64']] as const }];
    expect(configHash({ seed: 1 }, [])).toBe(configHash({ seed: 1 }));
    expect(configHash({ seed: 1 }, [...unit, ...health])).not.toBe(
      configHash({ seed: 1 }, [...health, ...unit])
    );
    expect(configHash({ seed: 1 }, unit)).not.toBe(configHash({ seed: 1 }));
    expect(
      configHash({ seed: 1 }, [
        {
          name: 'Unit',
          fields: [
            ['x', 'i32'],
            ['hp', 'u32'],
          ],
        },
      ])
    ).not.toBe(
      configHash({ seed: 1 }, [
        {
          name: 'Unit',
          fields: [
            ['hp', 'u32'],
            ['x', 'i32'],
          ],
        },
      ])
    );
    expect(
      configHash({ seed: 1 }, [{ name: 'Unit', fields: [['hp', 'u32']] }])
    ).not.toBe(
      configHash({ seed: 1 }, [{ name: 'Unit', fields: [['hp', 'i32']] }])
    );

    const marker = defineComponent('Marker', { n: 'u8' });
    const commands = defineCommands({ noop: {} });
    const game = defineGame({
      id: 'hash',
      simVersion: 'hash-1',
      tickRate: 10,
      components: [marker],
      commands,
      onCommand: { noop() {} },
      checkOutcome: () => null,
    });
    const config = hashConfig();
    const { side: _side, ...sharedConfig } = config;
    const transport = LocalTransport.stepped();
    const runner = new MatchRunner(game, config, transport);
    live.push(runner);
    runner.start();
    transport.step(1);
    const header = decodeSnapshot(runner.snapshot()).header;
    expect(header.configHash).toBe(
      configHash(
        sharedConfig,
        [{ name: 'Marker', fields: [['n', 'u8']] }],
        commands.schema
      )
    );
    expect(header.configHash).not.toBe(configHash(config));
  });

  it('rejects float fields and reserved section names', () => {
    // @ts-expect-error saved SoA fields are integers
    expect(() => defineComponent('Floaty', { x: 'f32' })).toThrow(/f32/);
    // @ts-expect-error saved SoA fields are integers
    expect(() => defineComponent('Floaty', { x: 'f64' })).toThrow(/f64/);
    expect(() => defineComponent('gas', { n: 'u8' })).toThrow(/reserved/);
    expect(() => defineComponent('SoASchema', { n: 'u8' })).toThrow(/reserved/);
    expect(() => defineComponent('Bad', { a: 'u16' as 'i32' })).toThrow(
      /allowed types are i32, u32, u8, i64, f32, f64/
    );
  });

  it('rolls back SoA rows when spawn fails part way', () => {
    let destroyed = 0;
    const unit = defineComponent(
      'Unit',
      { x: 'i32' },
      {
        onDestroy() {
          destroyed += 1;
        },
      }
    );
    const boom = defineComponent(
      'Boom',
      { n: 'u8' },
      {
        onCreate() {
          throw new Error('boom');
        },
      }
    );
    const world = openRegistered((registered) => {
      registered.registerComponent(unit);
      registered.registerComponent(boom);
    });
    live.push(world);
    expect(() => spawn(world, { Unit: { x: 1 }, Missing: {} })).toThrow(
      /not registered/
    );
    expect(() => spawn(world, { Unit: { x: 1 }, Boom: { n: 1 } })).toThrow(
      /boom/
    );
    expect(destroyed).toBe(2);
    expect(world.entityManager.getAllEntities()).toEqual([]);
    expect(world.entityManager.getSoAStore(unit.schema)?.entityIds()).toEqual(
      []
    );
    expect(world.entityManager.getSoAStore(boom.schema)?.entityIds()).toEqual(
      []
    );
    const spawned = spawn(world, { Unit: { x: 4 } });
    expect(world.entityManager.getSoAStore(unit.schema)?.entityIds()).toEqual([
      spawned.id,
    ]);
  });

  it('writes the visited row after another entity is despawned', () => {
    const unit = defineComponent(
      'Unit',
      { x: 'i32', hp: 'u32' },
      { defaults: { hp: 1 } }
    );
    const world = openRegistered((registered) => {
      registered.registerComponent(unit);
    });
    live.push(world);
    const first = spawn(world, { Unit: { x: 1, hp: 1 } });
    const second = spawn(world, { Unit: { x: 2, hp: 1 } });
    each(world, unit, (row) => {
      if (row.x === 2) {
        despawn(world, first);
        row.hp = 9;
      }
    });
    expect(world.entityManager.getEntity(first.id)).toBeUndefined();
    let hp = 0;
    each(world, unit, (row) => {
      hp = row.hp;
    });
    expect(hp).toBe(9);
    expect(second.id).toBe(2);

    const again = openRegistered((registered) => {
      registered.registerComponent(unit);
    });
    live.push(again);
    const current = spawn(again, { Unit: { x: 1, hp: 1 } });
    spawn(again, { Unit: { x: 2, hp: 1 } });
    expect(() => {
      each(again, unit, (row) => {
        if (row.x !== 1) return;
        despawn(again, current);
        row.hp = 3;
      });
    }).toThrow(`each: entity ${String(current.id)} was removed`);
  });

  it('finds spawned entities with queryEntities', () => {
    const unit = defineComponent('Unit', { x: 'i32' });
    const tag = defineComponent('Tag', { k: 'u8' });
    const world = openRegistered((registered) => {
      registered.registerComponent(unit);
      registered.registerComponent(tag);
    });
    live.push(world);
    const both = spawn(world, { Unit: { x: 1 }, Tag: { k: 2 } });
    const only = spawn(world, { Unit: { x: 3 } });
    expect(idsOf(world.entityManager.queryEntities(unit.type))).toEqual([
      both.id,
      only.id,
    ]);
    expect(idsOf(world.entityManager.queryEntities(tag.type))).toEqual([
      both.id,
    ]);
    expect(
      idsOf(world.entityManager.queryEntities(unit.type, tag.type))
    ).toEqual([both.id]);
    expect(
      idsOf(world.entityManager.queryEntitiesAny(tag.type, unit.type))
    ).toEqual([both.id, only.id]);
  });

  it('updates the component index when restore adds or drops a component', () => {
    let destroyed = 0;
    const unit = defineComponent('Unit', { x: 'i32' });
    const tag = defineComponent(
      'Tag',
      { k: 'u8' },
      {
        onDestroy() {
          destroyed += 1;
        },
      }
    );
    const withTag = openRegistered((registered) => {
      registered.registerComponent(unit);
      registered.registerComponent(tag);
    });
    live.push(withTag);
    spawn(withTag, { Unit: { x: 1 }, Tag: { k: 3 } });
    const tagged = saveWorld(withTag);

    const bare = openRegistered((registered) => {
      registered.registerComponent(unit);
      registered.registerComponent(tag);
    });
    live.push(bare);
    const kept = spawn(bare, { Unit: { x: 9 } });
    restoreWorld(bare, tagged);
    expect(idsOf(bare.entityManager.queryEntities(tag.type))).toEqual([
      kept.id,
    ]);

    const onlyUnit = openRegistered((registered) => {
      registered.registerComponent(unit);
      registered.registerComponent(tag);
    });
    live.push(onlyUnit);
    spawn(onlyUnit, { Unit: { x: 1 } });
    const untagged = saveWorld(onlyUnit);
    const extra = openRegistered((registered) => {
      registered.registerComponent(unit);
      registered.registerComponent(tag);
    });
    live.push(extra);
    spawn(extra, { Unit: { x: 1 }, Tag: { k: 4 } });
    destroyed = 0;
    restoreWorld(extra, untagged);
    expect(destroyed).toBe(1);
    expect(extra.entityManager.queryEntities(tag.type)).toEqual([]);
    expect(extra.entityManager.getSoAStore(tag.schema)?.entityIds()).toEqual(
      []
    );
  });

  it('restores two component sets into an empty world', () => {
    const unit = defineComponent(
      'Unit',
      { x: 'i32', hp: 'u32' },
      { defaults: { hp: 100 } }
    );
    const tag = defineComponent('Tag', { k: 'u8' });
    const source = openRegistered((world) => {
      world.registerComponent(unit);
      world.registerComponent(tag);
    });
    live.push(source);
    spawn(source, { Unit: { x: 1 } });
    spawn(source, { Unit: { x: 2 }, Tag: { k: 5 } });
    each(source, unit, (row) => {
      row.hp = 7;
    });
    const bytes = saveWorld(source);

    const empty = openRegistered((world) => {
      world.registerComponent(unit);
      world.registerComponent(tag);
    });
    live.push(empty);
    restoreWorld(empty, bytes);
    expect(saveWorld(empty)).toEqual(bytes);
    const units: string[] = [];
    each(empty, unit, (row) => {
      units.push(`${String(row.x)}/${String(row.hp)}`);
    });
    const tags: string[] = [];
    each(empty, tag, (row) => {
      tags.push(String(row.k));
    });
    expect(units).toEqual(['1/7', '2/7']);
    expect(tags).toEqual(['5']);
  });

  it('drops a startup entity the snapshot already removed', () => {
    const unit = defineComponent('Unit', { x: 'i32' });
    const source = openRegistered((world) => {
      world.registerComponent(unit);
    });
    live.push(source);
    spawn(source, { Unit: { x: 1 } });
    const gone = spawn(source, { Unit: { x: 2 } });
    despawn(source, gone);
    const bytes = saveWorld(source);

    const populated = openRegistered((world) => {
      world.registerComponent(unit);
    });
    live.push(populated);
    spawn(populated, { Unit: { x: 1 } });
    spawn(populated, { Unit: { x: 2 } });
    restoreWorld(populated, bytes);
    expect(saveWorld(populated)).toEqual(bytes);
    expect(populated.entityManager.getAllEntities()).toHaveLength(1);
  });

  it('returns a checked-out pool entity before reading pools', () => {
    const unit = defineComponent(
      'Hp',
      { hp: 'i64' },
      { defaults: { hp: 48n } }
    );
    class Pawn extends Entity implements IPoolableEntity {
      public constructor(id: number) {
        super(id);
        this.addComponent(unit.create(this.id));
      }

      public onSpawn(_args: void): void {}

      public onDespawn(): void {}
    }
    const open = (): GameWorld => {
      const world = new GameWorld({
        tickFrameProvider: silentProvider(),
        random: new DeterministicRandom(1),
        pooling: {
          entityTypes: {
            pawn: {
              factory: (id) => new Pawn(id),
              pool: { initialSize: 1 },
            },
          },
        },
      });
      world.registerComponent(unit);
      world.registerSystems([], []);
      world.start();
      const pools = world.pools;
      if (pools === null) throw new Error('expected pools');
      pools.spawn<Pawn>('pawn');
      return world;
    };
    const source = open();
    live.push(source);
    setHp(source, unit, 1, 9n);
    const bytes = saveWorld(source);
    const target = open();
    live.push(target);
    restoreWorld(target, bytes);
    expect(hpOf(target, unit, 1)).toBe(9n);
    expect(saveWorld(target)).toEqual(bytes);
  });

  it('rejects a snapshot whose component fields changed', () => {
    const ordered = defineComponent(
      'Unit',
      { x: 'i32', hp: 'u32' },
      { defaults: { hp: 4 } }
    );
    const swapped = defineComponent(
      'Unit',
      { hp: 'u32', x: 'i32' },
      { defaults: { hp: 4 } }
    );
    const transport = LocalTransport.stepped();
    const writer = new MatchRunner(
      schemaGame(ordered),
      schemaConfig(),
      transport
    );
    live.push(writer);
    writer.start();
    transport.step(1);
    const snapshot = writer.snapshot();

    const reader = new MatchRunner(
      schemaGame(swapped),
      schemaConfig(),
      LocalTransport.stepped()
    );
    live.push(reader);
    expect(() => reader.restore(snapshot)).toThrow(
      "component 'Unit' schema changed: expected x:i32,hp:u32, got hp:u32,x:i32"
    );

    const narrowed = defineComponent(
      'Unit',
      { x: 'i32', hp: 'i32' },
      { defaults: { hp: 4 } }
    );
    const typed = new MatchRunner(
      schemaGame(narrowed),
      schemaConfig(),
      LocalTransport.stepped()
    );
    live.push(typed);
    expect(() => typed.restore(snapshot)).toThrow(
      "component 'Unit' schema changed: expected x:i32,hp:u32, got x:i32,hp:i32"
    );
  });

  it('restores arena when onStart spawns the pawn on restore', async () => {
    const { onStart, ...rest } = ArenaGame;
    const game = defineGame({
      ...rest,
      onStart: (ctx) => onStart?.({ ...ctx, purpose: 'fresh' }),
    });
    const config = arenaConfig();
    const transport = LocalTransport.stepped();
    const runner = new MatchRunner(game, config, transport, {
      hashEveryTicks: 1,
    });
    live.push(runner);
    const digests: string[] = [];
    runner.onDigest((tick, digest) => {
      digests[tick] = digest;
    });
    runner.start();
    transport.step(SNAPSHOT_TICK + 1);
    runner.flush();
    const snapshot = runner.snapshot();
    const atSnapshot = runner.digest();
    transport.step(THROUGH - SNAPSHOT_TICK);
    runner.flush();
    const tail = runner.log
      .entriesAfter(SNAPSHOT_TICK)
      .filter((entry) => entry.tick <= THROUGH);

    const copy = new MatchRunner(game, config, LocalTransport.stepped(), {
      hashEveryTicks: 1,
    });
    live.push(copy);
    copy.restore(snapshot);
    expect(copy.tick).toBe(SNAPSHOT_TICK);
    expect(copy.digest()).toBe(atSnapshot);
    await copy.fastForward(tail, { budgetMs: 1000, throughTick: THROUGH });
    expect(copy.digest()).toBe(runner.digest());
    expect(copy.digest()).toBe(digests[THROUGH]);
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
    const spawned = spawn(source, { Unit: { hp: 4n } });
    each(source, unit, (row) => {
      row.hp = 3n;
    });
    const bytes = saveWorld(source);
    expect(spawned.id).toBe(1);

    enables = 0;
    const restored = openWorld(unit);
    live.push(restored);
    spawn(restored, { Unit: { hp: 10n } });
    expect(enables).toBe(1);
    expect(() => restoreWorld(restored, bytes)).not.toThrow();
    expect(enables).toBe(2);
    let hp = 0n;
    each(restored, unit, (row) => {
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
      public constructor(id: number) {
        super(id);
        this.addComponent(unit.create(this.id));
      }

      public onSpawn(_args: void): void {}

      public onDespawn(): void {}
    }
    const world = new GameWorld({
      tickFrameProvider: silentProvider(),
      pooling: {
        entityTypes: {
          pawn: { factory: (id) => new Pawn(id) },
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

  it('despawn returns a pooled entity to its pool', () => {
    const unit = defineComponent('Hp', { hp: 'i64' });
    class Pawn extends Entity implements IPoolableEntity {
      public constructor(id: number) {
        super(id);
        this.addComponent(unit.create(this.id));
      }

      public onSpawn(_args: void): void {}

      public onDespawn(): void {}
    }
    const world = new GameWorld({
      tickFrameProvider: silentProvider(),
      pooling: {
        entityTypes: {
          pawn: { factory: (id) => new Pawn(id) },
        },
      },
    });
    live.push(world);
    world.registerComponent(unit);
    const pools = world.pools;
    if (pools === null) throw new Error('expected pools');
    const pawn = pools.spawn<Pawn>('pawn');
    despawn(world, pawn);
    expect(pawn._inPool).toBe(true);
    expect(pools.spawn<Pawn>('pawn')).toBe(pawn);
  });

  it('continues a default-state world after restore', async () => {
    const unit = defineComponent('Pos', { x: 'i64' }, { defaults: { x: 0n } });
    const commands = defineCommands({ step: {} });
    const game = defineGame({
      id: 'continue',
      simVersion: 'continue-1',
      tickRate: 10,
      components: [unit],
      commands,
      onStart(ctx) {
        if (ctx.purpose === 'fresh') spawn(ctx.world, { Pos: { x: 1n } });
      },
      onCommand: {
        step(ctx) {
          each(ctx.world, unit, (row) => {
            row.x += 1n;
          });
        },
      },
      checkOutcome: () => null,
    });
    const config = continueConfig();
    const transport = LocalTransport.stepped();
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
    runner.flush();
    const snapshot = runner.snapshot();
    const atSnapshot = runner.digest();
    transport.step(THROUGH - SNAPSHOT_TICK);
    runner.flush();
    expect(runner.tick).toBe(THROUGH);

    const tail = runner.log
      .entriesAfter(SNAPSHOT_TICK)
      .filter((entry) => entry.tick <= THROUGH);
    const copyTransport = LocalTransport.stepped();
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
    copy.flush();
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
  unit: SoaComponentDef<{ hp: 'i64' }>,
  entityId: number,
  hp: bigint
): void {
  let seen = -1;
  each(world, unit, (row) => {
    seen += 1;
    const ids = world.entityManager.getSoAStore(unit.schema)?.entityIds();
    if (ids?.[seen] === entityId) row.hp = hp;
  });
}

function hpOf(
  world: GameWorld,
  unit: SoaComponentDef<{ hp: 'i64' }>,
  entityId: number
): bigint {
  let value: bigint | undefined;
  let seen = -1;
  each(world, unit, (row) => {
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

function openWorld(component: SoaComponentDef<{ hp: 'i64' }>): GameWorld {
  const world = new GameWorld({
    random: new DeterministicRandom(1),
    tickFrameProvider: silentProvider(),
  });
  world.registerComponent(component);
  return world;
}

function captureTiny(): Map<number, { auto: Uint8Array; manual: Uint8Array }> {
  const transport = LocalTransport.stepped();
  const runner = new MatchRunner(TinyGame, tinyConfig(), transport);
  const saved = new Map<number, { auto: Uint8Array; manual: Uint8Array }>();
  runner.onTick((tick) => {
    if (!isSample(tick)) return;
    const sim = runner.sim;
    const writer = new BinaryStateWriter();
    new TinyState(sim).save(writer);
    saved.set(tick, { auto: saveWorld(sim.world), manual: writer.finish() });
  });
  runner.start();
  transport.step(LAST_TICK + 1);
  runner.dispose();
  return saved;
}

function captureArena(): Map<number, { auto: Uint8Array; manual: Uint8Array }> {
  const transport = LocalTransport.stepped();
  const runner = new MatchRunner(ArenaGame, arenaConfig(), transport);
  const saved = new Map<number, { auto: Uint8Array; manual: Uint8Array }>();
  runner.onTick((tick) => {
    if (!isSample(tick)) return;
    const sim = runner.sim;
    saved.set(tick, {
      auto: saveWorld(sim.world),
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
  StateHelpers.writeEntityIds(writer, sim.world);
  StateHelpers.writeRandom(writer, sim.random);
  writer.section('modules', 1, (section) => {
    section.list(sim.world.saveSections, (saveSection, item) => {
      item.section(saveSection.key, saveSection.version, (body) => {
        saveSection.write(body, sim.world);
      });
    });
  });
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
    side: 'client',
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
    side: 'client',
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
    side: 'client',
    inputDelayTicks: 2,
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
  };
}

function idsOf(entities: readonly { id: number }[]): number[] {
  return entities.map((entity) => entity.id);
}

function openRegistered(register: (world: GameWorld) => void): GameWorld {
  const world = new GameWorld({
    random: new DeterministicRandom(1),
    tickFrameProvider: silentProvider(),
  });
  register(world);
  return world;
}

function schemaGame<S extends SoASchemaDefinition>(unit: SoaComponentDef<S>) {
  const commands = defineCommands({ noop: {} });
  return defineGame({
    id: 'schema-hash',
    simVersion: 'schema-1',
    tickRate: 10,
    components: [unit],
    commands,
    onStart(ctx) {
      if (ctx.purpose === 'fresh') {
        spawn(ctx.world, { Unit: { x: 3, hp: 4 } });
      }
    },
    onCommand: { noop() {} },
    checkOutcome: () => null,
  });
}

function schemaConfig(): MatchConfigBase {
  return {
    matchId: 'm',
    gameId: 'schema-hash',
    simVersion: 'schema-1',
    seed: 1,
    side: 'client',
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
    side: 'client',
    inputDelayTicks: 2,
    slots: [{ slot: 0, team: 0, kind: 'human', playerId: 'local:0' }],
  };
}
