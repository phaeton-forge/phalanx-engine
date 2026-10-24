import {
  Entity,
  GameSystem,
  type EntityManager,
  type IPoolableEntity,
} from '@phalanx-engine/ecs';
import type { GameWorld, IRandom } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  AbilityOwner,
  abilityOwnerOf,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
} from '@phalanx-engine/abilities';
import {
  PhysicsSoASchema,
  PhysicsWorld,
  TransformSoASchema,
  attachPhysicsBody,
  attachTransform,
  setVelocity,
  writeFpPosition,
} from '@phalanx-engine/physics';
import {
  defineCommands,
  defineGame,
  rejectCommand,
  type MatchConfigBase,
} from '../../src/index.js';

const CELL = FP.FromInt(4);
const HEALTH = FP.FromInt(50);
const MOVE_X = FP.FromInt(1);
const SPAWN_POSITION = { x: FP.FromInt(2), y: FP._0, z: FP.FromInt(-1) };
const HEALTH_STEP = FP.ToRaw(FP._1);

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
export class ArenaSim {
  public constructor(
    public readonly world: GameWorld,
    public readonly random: IRandom,
    public readonly config: ArenaConfig
  ) {}

  public healthRaw(): bigint {
    const pawn = this.world.entityManager.getAllEntities()[0];
    if (pawn === undefined) throw new Error('arena: missing pawn');
    const raw = abilityOwnerOf(pawn)?.attributes.current[0];
    if (raw === undefined) throw new Error('arena: missing health');
    return raw;
  }
}

const abilitiesByManager = new WeakMap<
  object,
  ReturnType<typeof createAbilitySystem>
>();

class ArenaPawn extends Entity implements IPoolableEntity<void> {
  public constructor(id: number, manager: EntityManager) {
    super(id);
    const abilities = abilitiesByManager.get(manager);
    if (abilities === undefined) {
      throw new Error('arena: ability system is not ready');
    }
    attachTransform(this, SPAWN_POSITION);
    attachPhysicsBody(this, {
      radius: FP._1,
      mass: FP._1,
      restitution: FP._0,
      friction: FP._0,
      useGravity: false,
    });
    this.addComponent(
      abilities.initComponent({
        attributes: { Health: HEALTH },
        tags: ['Team.Pawn'],
        abilities: ['Ability.Hold'],
      })
    );
  }

  public onSpawn(_args: void): void {
    writeFpPosition(this, SPAWN_POSITION);
    setVelocity(this, MOVE_X, FP._0, FP._0);
  }

  public onDespawn(): void {}
}

class HpDecaySystem extends GameSystem {
  public override processTick(_tick: number): void {
    this.random.int(1);
    const pawns = this.entityManager.queryEntities(AbilityOwner.type);
    for (const pawn of pawns) {
      const attributes = abilityOwnerOf(pawn)?.attributes;
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

const commands = defineCommands(
  { hold: {} },
  {
    validate: () => rejectCommand('unused'),
  }
);

export const ArenaGame = defineGame<ArenaConfig, ArenaCommand, ArenaSim>({
  id: 'arena',
  simVersion: 'arena-1',
  tickRate: 10,
  commands,
  pooling: {
    entityTypes: {
      pawn: {
        factory: (id, manager) => new ArenaPawn(id, manager),
        pool: { initialSize: 1 },
      },
    },
  },
  onStart: (ctx) => {
    const abilities = createAbilitySystem(ctx.world, {
      definitions,
      pipeline: 'effects',
    });
    abilitiesByManager.set(ctx.world.entityManager, abilities);
    const physics = new PhysicsWorld({
      tickRate: 10,
      subSteps: 1,
      gridCellSize: CELL,
      gravity: FP._0,
    });
    physics.attach(ctx.world);
    // Store order is the snapshot order. Gravity init would create
    // PhysicsBody first; the fixture's manual save lists Transform first.
    ctx.world.entityManager.getOrCreateSoAStore(TransformSoASchema);
    ctx.world.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
    const { gravitySystem, physicsSystem } = physics.getSystems();
    ctx.world.registerSystems(
      [
        gravitySystem,
        physicsSystem,
        ...abilities.tickSystems,
        new HpDecaySystem(),
      ],
      []
    );
    ctx.open();
    if (ctx.purpose === 'fresh') {
      const pools = ctx.world.pools;
      if (pools === null) throw new Error('arena: expected pools');
      pools.spawn<ArenaPawn>('pawn');
    }
    return new ArenaSim(ctx.world, ctx.rng, ctx.config);
  },
  onCommand: {
    hold() {},
  },
  checkOutcome: () => null,
});
