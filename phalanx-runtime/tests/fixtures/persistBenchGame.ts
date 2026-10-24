import { Entity, GameSystem, type IPoolableEntity } from '@phalanx-engine/ecs';
import type { GameWorld, IRandom } from '@phalanx-engine/ecs';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import {
  AbilityOwner,
  Attributes,
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
} from '@phalanx-engine/abilities';
import {
  PhysicsWorld,
  attachPhysicsBody,
  attachTransform,
  setVelocity,
  writeFpPosition,
} from '@phalanx-engine/physics';
import {
  defineCommands,
  defineGame,
  type MatchConfigBase,
} from '../../src/index.js';

const CELL = FP.FromInt(8);
const HEALTH = FP.FromInt(50);
const HEALTH_STEP = FP.ToRaw(FP._1);
const COLUMNS = 40;

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

interface SpawnIndex {
  readonly index: number;
}

/**
 * Pooled GAS pawn plus a physics body. `unitCount` units are prewarmed and
 * spawned on a grid so a snapshot tick saves attributes, pools, and SoA
 * bodies. Health steps down every tick, so a later snapshot differs.
 */
export function createPersistBenchGame(unitCount: number) {
  if (!Number.isInteger(unitCount) || unitCount < 1) {
    throw new Error('persist bench: unitCount must be >= 1');
  }
  const positions: { x: FixedPoint; y: FixedPoint; z: FixedPoint }[] = [];
  for (let index = 0; index < unitCount; index += 1) {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    positions.push({
      x: FP.FromInt(column * 8),
      y: FP._0,
      z: FP.FromInt(row * 8),
    });
  }

  class BenchUnit extends Entity implements IPoolableEntity<SpawnIndex> {
    public constructor(id: number, world: GameWorld) {
      super(id);
      attachTransform(this, { x: FP._0, y: FP._0, z: FP._0 });
      attachPhysicsBody(this, {
        radius: FP._1,
        mass: FP._1,
        restitution: FP._0,
        friction: FP._0,
        useGravity: false,
      });
      world.addComponent(this, AbilityOwner, {
        attributes: { Health: HEALTH },
        tags: ['Team.Bench'],
        abilities: ['Ability.Hold'],
      });
    }

    public onSpawn(args: SpawnIndex): void {
      const position = positions[args.index];
      if (position !== undefined) writeFpPosition(this, position);
      setVelocity(this, FP._0, FP._0, FP._0);
    }

    public onDespawn(): void {}
  }

  class HpDecaySystem extends GameSystem {
    public override processTick(_tick: number): void {
      this.random.int(1);
      for (const [, , attributes] of this.world.query(
        AbilityOwner,
        Attributes
      )) {
        const base = attributes.base[0];
        if (base === undefined || base <= 0n) {
          continue;
        }
        const next = base > HEALTH_STEP ? base - HEALTH_STEP : 0n;
        attributes.base[0] = next;
        attributes.current[0] = next;
        attributes.dirty[0] = 1;
      }
    }
  }

  return defineGame<MatchConfigBase, { readonly type: 'hold' }, BenchSim>({
    id: `persist-bench-${String(unitCount)}`,
    simVersion: 'bench-1',
    tickRate: 20,
    commands: defineCommands({ hold: {} }),
    pooling: {
      entityTypes: {
        unit: {
          factory: (id, world) => new BenchUnit(id, world),
          pool: { initialSize: unitCount },
        },
      },
    },
    onStart: (ctx) => {
      const abilities = createAbilitySystem(ctx.world, {
        definitions,
        pipeline: 'effects',
      });
      const physics = new PhysicsWorld({
        tickRate: 20,
        subSteps: 1,
        gridCellSize: CELL,
        gravity: FP._0,
      });
      physics.attach(ctx.world);
      ctx.world.registerSystems(
        [...abilities.tickSystems, new HpDecaySystem()],
        []
      );
      ctx.open();
      if (ctx.purpose === 'fresh') {
        const pools = ctx.world.pools;
        if (pools === null) throw new Error('persist bench: expected pools');
        for (let index = 0; index < unitCount; index += 1) {
          pools.spawn<BenchUnit>('unit', { index });
        }
      }
      return new BenchSim(ctx.world, ctx.rng, ctx.config);
    },
    onCommand: {
      hold() {},
    },
    checkOutcome: () => null,
  });
}

class BenchSim {
  public constructor(
    public readonly world: GameWorld,
    public readonly random: IRandom,
    public readonly config: MatchConfigBase
  ) {}
}
