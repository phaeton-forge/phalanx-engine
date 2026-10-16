import {
  GameSystem,
  GameWorld,
  type IPoolableEntity,
  Entity,
} from '@phalanx-engine/ecs';
import type { IRandom } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  AbilitiesComponentType,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  getAbilitySystemComponent,
} from '@phalanx-engine/abilities';
import {
  PhysicsBodyComponent,
  PhysicsSoASchema,
  PhysicsWorld,
  TransformComponent,
  TransformSoASchema,
  PHYSICS_BODY_COMPONENT_TYPE,
  TRANSFORM_COMPONENT_TYPE,
} from '@phalanx-engine/physics';
import {
  defineGame,
  rejectCommand,
  type CommandRejection,
  type GameState,
  type JsonValue,
  type MatchConfigBase,
  type SimWorld,
  type StampedCommand,
  type StateReader,
  type StateWriter,
  type WorldInitContext,
} from '../../src/index.js';
import { StateHelpers } from '../../src/advanced/index.js';

const CELL = FP.FromInt(4);
const HEALTH = FP.FromInt(50);
const MOVE_X = FP.FromInt(1);
const SPAWN_POSITION = { x: FP.FromInt(2), y: FP._0, z: FP.FromInt(-1) };
const HEALTH_STEP = FP.ToRaw(FP._1);

const SCHEMAS = [TransformSoASchema, PhysicsSoASchema] as const;

const definitions = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: HEALTH,
      min: FP._0,
      max: HEALTH,
      clamp: 'both',
    }),
  ],
  abilities: [
    defineAbility({
      id: 'Ability.Hold',
      target: { kind: 'Self' },
    }),
  ],
});

export type ArenaConfig = MatchConfigBase;

export type ArenaCommand = { readonly type: 'hold' };

/**
 * One pooled pawn with GAS and a physics body. `onSpawn` sets the
 * transform and velocity and does not rewrite attributes, so a pool
 * return must restore the factory Health for a later respawn to match
 * a restored world. There is no bot.
 */
export class ArenaSim implements SimWorld<ArenaCommand> {
  public constructor(
    public readonly world: GameWorld,
    public readonly random: IRandom,
    public readonly config: ArenaConfig
  ) {}

  public applyCommand(_stamped: StampedCommand<ArenaCommand>): void {}

  public healthRaw(): bigint {
    const pawn = this.world.entityManager.getAllEntities()[0];
    if (pawn === undefined) throw new Error('arena: missing pawn');
    const raw = getAbilitySystemComponent(pawn)?.attributes.current[0];
    if (raw === undefined) throw new Error('arena: missing health');
    return raw;
  }
}

class ArenaPawn extends Entity implements IPoolableEntity<void> {
  public constructor(abilities: ReturnType<typeof createAbilitySystem>) {
    super();
    this.addComponent(new TransformComponent(this.id, SPAWN_POSITION));
    this.addComponent(
      new PhysicsBodyComponent(this.id, {
        radius: FP._1,
        mass: FP._1,
        restitution: FP._0,
        friction: FP._0,
        useGravity: false,
      })
    );
    this.addComponent(
      abilities.initComponent({
        attributes: { Health: HEALTH },
        tags: ['Team.Pawn'],
        abilities: ['Ability.Hold'],
      })
    );
  }

  public onSpawn(_args: void): void {
    const transform = this.getComponent<TransformComponent>(
      TRANSFORM_COMPONENT_TYPE
    );
    if (transform !== undefined) transform.fpPosition = SPAWN_POSITION;
    const body = this.getComponent<PhysicsBodyComponent>(
      PHYSICS_BODY_COMPONENT_TYPE
    );
    body?.setVelocity(MOVE_X, FP._0, FP._0);
  }

  public onDespawn(): void {}
}

class HpDecaySystem extends GameSystem {
  public override processTick(_tick: number): void {
    this.random.int(1);
    const pawns = this.entityManager.queryEntities(
      AbilitiesComponentType.AbilitySystem
    );
    for (const pawn of pawns) {
      const attributes = getAbilitySystemComponent(pawn)?.attributes;
      const base = attributes?.base[0];
      if (attributes === undefined || base === undefined || base <= 0n) {
        continue;
      }
      const next = base > HEALTH_STEP ? base - HEALTH_STEP : 0n;
      attributes.base[0] = next;
      attributes.current[0] = next;
      attributes.dirty[0] = 1;
    }
  }
}

class ArenaState implements GameState {
  public constructor(private readonly sim: ArenaSim) {}

  public save(w: StateWriter): void {
    StateHelpers.writePools(w, this.sim.world);
    StateHelpers.writeSoAStores(w, this.sim.world, SCHEMAS);
    StateHelpers.writeAbilities(w, this.sim.world);
    StateHelpers.writeEntityIds(w, this.sim.world);
    StateHelpers.writeRandom(w, this.sim.random);
    StateHelpers.writeBroadphase(w, this.sim.world);
  }

  public restore(r: StateReader): void {
    StateHelpers.readPools(r, this.sim.world);
    StateHelpers.readSoAStores(r, this.sim.world, SCHEMAS);
    StateHelpers.readAbilities(r, this.sim.world);
    StateHelpers.readEntityIds(r, this.sim.world);
    StateHelpers.readRandom(r, this.sim.random);
    StateHelpers.readBroadphase(r, this.sim.world);
  }
}

export const ArenaGame = defineGame({
  id: 'arena',
  simVersion: 'arena-1',
  tickRate: 10,
  createWorld: (config: ArenaConfig, ctx: WorldInitContext): ArenaSim => {
    const holder: { abilities?: ReturnType<typeof createAbilitySystem> } = {};
    const world = new GameWorld({
      tickFrameProvider: ctx.tickFrameProvider,
      random: ctx.random,
      tickRate: 10,
      pooling: {
        entityTypes: {
          pawn: {
            factory: () => {
              const abilities = holder.abilities;
              if (abilities === undefined) {
                throw new Error('arena: ability system is not ready');
              }
              return new ArenaPawn(abilities);
            },
            pool: { initialSize: 1 },
          },
        },
      },
    });
    const abilities = createAbilitySystem(world, {
      definitions,
      pipeline: 'effects',
    });
    holder.abilities = abilities;
    const physics = new PhysicsWorld({
      tickRate: 10,
      subSteps: 1,
      gridCellSize: CELL,
      gravity: FP._0,
    });
    world.context.physics = physics;
    // Store order is the snapshot order. Gravity init would create
    // PhysicsBody first; the fixture's manual save lists Transform first.
    world.entityManager.getOrCreateSoAStore(TransformSoASchema);
    world.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const { gravitySystem, physicsSystem } = physics.getSystems();
    world.registerSystems(
      [
        gravitySystem,
        physicsSystem,
        ...abilities.tickSystems,
        new HpDecaySystem(),
      ],
      []
    );
    world.start();
    if (ctx.purpose === 'fresh') {
      const pools = world.pools;
      if (pools === null) throw new Error('arena: expected pools');
      pools.spawn<ArenaPawn>('pawn');
    }
    return new ArenaSim(world, ctx.random, config);
  },
  commands: {
    types: ['hold'],
    decode: (): ArenaCommand | CommandRejection => rejectCommand('unused'),
    encode: (): JsonValue => ({ type: 'hold' }),
  },
  state: {
    formatVersion: 1,
    bind: (sim) => new ArenaState(sim),
  },
  outcome: () => null,
});
