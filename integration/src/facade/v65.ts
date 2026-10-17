import {
  FP,
  PhysicsSoASchema,
  PhysicsWorld,
  TransformSoASchema,
  bindWorldSingletons,
  createAbilitySystem,
  defineCommands,
  defineGame,
  rejectCommand,
  type AbilitySystem,
  type BotPolicy,
  type BotSlotInfo,
  type CollisionEvent,
  type IRandom,
  type StateReader,
  type StateWriter,
} from '@phalanx-engine/engine';
import type { BotMemory } from './GameFacade.js';
import { decideAggressive, decideDefensive } from '../game/skirmish/bots.js';
import { tickLimitOutcome } from '../game/skirmish/outcome.js';
import { rosterPlans } from '../game/skirmish/roster.js';
import { applySkirmish, rejectReason } from '../game/skirmish/rules.js';
import {
  KIND_ARCHER,
  KIND_SOLDIER,
  KIND_TOTEM,
  type SkirmishCommand,
} from '../game/skirmish/types.js';
import {
  AuraSystem,
  CELL,
  ClearContacts,
  DEFINITIONS,
  LifeSystem,
  RangedDef,
  SkirmishSim,
  UnitDef,
  buildUnit,
  hasState,
  type SkirmishConfig,
  type SkirmishSession,
} from './skirmishWorld.js';

export type { SkirmishConfig, SkirmishSession } from './skirmishWorld.js';

/**
 * Bot memory is outside the snapshot digest. `restore` reads the saved
 * phase and target back into the policy. Suite mutants `b` and `b2`
 * anchor on the two assignments below.
 */
class Policy implements BotPolicy<SkirmishCommand, SkirmishSim> {
  private readonly memory: BotMemory = { target: 0, phase: 0 };
  private readonly peerId: string;

  public constructor(
    private readonly slot: number,
    private readonly rng: IRandom,
    private readonly aggressive: boolean,
    private readonly session: SkirmishSession
  ) {
    this.peerId = session.currentPeer;
  }

  public decide(
    sim: Readonly<SkirmishSim>,
    tick: number
  ): readonly SkirmishCommand[] {
    if (this.session.throwBot && tick === 2) throw new Error('bot exploded');
    const roll = this.rng.int(4);
    const view = sim.viewFor(this.slot);
    const commands = this.aggressive
      ? decideAggressive(view, this.memory, roll)
      : decideDefensive(view, this.memory, roll);
    this.note();
    return commands;
  }

  public save(writer: StateWriter): void {
    writer.u32(this.memory.phase);
    writer.i32(this.memory.target);
  }

  public restore(reader: StateReader): void {
    const phase = reader.u32();
    const target = reader.i32();
    if (this.session.breakBotRestore) {
      this.memory.phase = 0;
      this.memory.target = 0;
    } else {
      this.memory.phase = phase;
      this.memory.target = target;
    }
    this.note();
  }

  private note(): void {
    const row = this.session.bots[this.peerId] ?? {};
    this.session.bots[this.peerId] = row;
    const words = hasState(this.rng)
      ? this.rng.getState().map((word) => String(word))
      : [];
    row[String(this.slot)] = {
      phase: String(this.memory.phase),
      target: String(this.memory.target),
      rng: words.join(','),
    };
  }
}

const COMMANDS = defineCommands(
  {
    move: { dir: 'i32' },
    attack: { target: 'i32' },
    cast: { ability: 'i32', target: 'i32' },
    spawn: { kind: 'i32' },
    recall: {},
  },
  {
    validate(command, slot, sim) {
      if (!(sim instanceof SkirmishSim)) return null;
      const reason = rejectReason(sim, command, slot.slot);
      return reason === null ? null : rejectCommand(reason);
    },
  }
);

export function createSkirmishGame(
  session: SkirmishSession,
  pools: { readonly armySize: number; readonly slotCount: number } = {
    armySize: 0,
    slotCount: 2,
  }
): ReturnType<typeof defineGame<SkirmishConfig, SkirmishCommand, SkirmishSim>> {
  const holder: { abilities?: AbilitySystem } = {};
  const soldierPool = pools.armySize > 0 ? pools.armySize : pools.slotCount + 8;
  const archerPool = pools.armySize > 0 ? 1 : 6;
  const totemPool = pools.armySize > 0 ? 1 : 4;
  return defineGame({
    id: 'skirmish',
    simVersion: 'skirmish-1',
    tickRate: 10,
    components: [UnitDef, RangedDef],
    pooling: {
      entityTypes: {
        soldier: {
          factory: () => buildUnit(KIND_SOLDIER, holder, true, false),
          pool: { initialSize: soldierPool },
        },
        archer: {
          factory: () => buildUnit(KIND_ARCHER, holder, true, true),
          pool: { initialSize: archerPool },
        },
        totem: {
          factory: () => buildUnit(KIND_TOTEM, holder, false, false),
          pool: { initialSize: totemPool },
        },
      },
    },
    onStart: (ctx): SkirmishSim => {
      const world = ctx.world;
      world.entityManager.getOrCreateSoAStore(TransformSoASchema);
      world.entityManager.getOrCreateSoAStore(PhysicsSoASchema);
      const abilities = createAbilitySystem(world, {
        definitions: DEFINITIONS,
        pipeline: 'full',
      });
      holder.abilities = abilities;
      const physics = new PhysicsWorld({
        tickRate: 10,
        subSteps: 1,
        gridCellSize: CELL,
        gravity: FP._0,
      });
      world.context.physics = physics;
      const sim = new SkirmishSim(
        world,
        ctx.rng,
        ctx.config,
        abilities,
        session
      );
      bindWorldSingletons(world, {
        onSave: (writer) => {
          sim.saveJobs(writer);
        },
        onRestore: (reader) => {
          sim.loadJobs(reader);
        },
      });
      const { gravitySystem, physicsSystem } = physics.getSystems();
      world.registerSystems(
        [
          new ClearContacts(sim),
          gravitySystem,
          physicsSystem,
          new AuraSystem(sim),
          ...abilities.tickSystems,
          new LifeSystem(sim),
        ],
        []
      );
      ctx.open();
      physics.onCollision((event: CollisionEvent) => {
        sim.noteContact(event.entityA, event.entityB);
      });
      const spawn = ctx.purpose === 'fresh' || session.spawnOnRestore;
      if (spawn) {
        for (const plan of rosterPlans(ctx.config.armySize, ctx.config.slots)) {
          sim.acquire(plan.kind, plan.slot, plan.team, plan.x, plan.z);
        }
      }
      return sim;
    },
    commands: COMMANDS,
    onCommand: {
      move: (ctx, stamped) => {
        applySkirmish(
          ctx.sim,
          stamped.command,
          stamped.slot,
          ctx.sim.unitOf(stamped.slot)
        );
      },
      attack: (ctx, stamped) => {
        applySkirmish(
          ctx.sim,
          stamped.command,
          stamped.slot,
          ctx.sim.unitOf(stamped.slot)
        );
      },
      cast: (ctx, stamped) => {
        applySkirmish(
          ctx.sim,
          stamped.command,
          stamped.slot,
          ctx.sim.unitOf(stamped.slot)
        );
      },
      spawn: (ctx, stamped) => {
        applySkirmish(
          ctx.sim,
          stamped.command,
          stamped.slot,
          ctx.sim.unitOf(stamped.slot)
        );
      },
      recall: (ctx, stamped) => {
        applySkirmish(
          ctx.sim,
          stamped.command,
          stamped.slot,
          ctx.sim.unitOf(stamped.slot)
        );
      },
    },
    bots: {
      aggressive: (_config, slot: BotSlotInfo, rng: IRandom) =>
        new Policy(slot.slot, rng, true, session),
      defensive: (_config, slot: BotSlotInfo, rng: IRandom) =>
        new Policy(slot.slot, rng, false, session),
    },
    checkOutcome: (sim) =>
      tickLimitOutcome(sim.tickValue, sim.config.tickLimit),
  });
}
