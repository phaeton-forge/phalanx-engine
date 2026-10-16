import {
  Entity,
  GameSystem,
  GameWorld,
  SoAComponent,
  type IPoolableEntity,
  type IRandom,
} from '@phalanx-engine/ecs';
import { FP, type FixedPoint } from '@phalanx-engine/math';
import {
  createAbilitySystem,
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  getAbilitySystemComponent,
  type AbilitySystem,
} from '@phalanx-engine/abilities';
import {
  PhysicsBodyComponent,
  PhysicsSoASchema,
  PhysicsWorld,
  TransformComponent,
  TransformSoASchema,
  PHYSICS_BODY_COMPONENT_TYPE,
  type CollisionEvent,
} from '@phalanx-engine/physics';
import {
  bindWorldSingletons,
  defineComponent,
  defineGame,
  rejectCommand,
  type BotPolicy,
  type BotSlotInfo,
  type CommandRejection,
  type JsonValue,
  type MatchConfigBase,
  type SimWorld,
  type StampedCommand,
  type StateReader,
  type StateWriter,
  type WorldInitContext,
} from '@phalanx-engine/runtime';
import type {
  BotMemory,
  BotNote,
  BotView,
  GameFacade,
  UnitView,
} from './GameFacade.js';
import { decideAggressive, decideDefensive } from '../game/skirmish/bots.js';
import { poolPhase } from '../game/skirmish/pool.js';
import { armySpawn, slotSpawn } from '../game/skirmish/roster.js';
import {
  applySkirmish,
  rejectReason,
  tickAura,
  tickLifecycle,
  type CommandSink,
  type CommandView,
} from '../game/skirmish/rules.js';
import {
  ABILITY_BANNER,
  ABILITY_STRIKE,
  EFFECT_BANNER,
  EFFECT_DAMAGE,
  KIND_ARCHER,
  KIND_SOLDIER,
  KIND_TOTEM,
  TAG_BANNER,
  TAG_COOLDOWN,
  TAG_INIT,
  type SkirmishCommand,
} from '../game/skirmish/types.js';

const HEALTH = FP.FromInt(100);
const POWER = FP.FromInt(10);
const HEALTH_RAW = FP.ToRaw(HEALTH);
const POWER_RAW = FP.ToRaw(POWER);
/** Banner cooldown tag. Kept here so despawn can drop it without allocating. */
const BANNER_COOLDOWN = 'Cooldown.Ability.Banner';
const RADIUS = FP.FromInt(1);
const CELL = FP.FromInt(4);
const SPEED = FP.FromInt(3);
const NEG_SPEED = FP.FromInt(-3);
const VEL: readonly (readonly [FixedPoint, FixedPoint])[] = [
  [SPEED, FP._0],
  [FP._0, SPEED],
  [NEG_SPEED, FP._0],
  [FP._0, NEG_SPEED],
];

const DAMAGE = FP.FromInt(-15);
const BANNER_POWER = FP.FromInt(5);
const COOLDOWN_TICKS = 8;
const BANNER_TICKS = 40;
const RESPAWN_DELAY = 12;
const JOB_SLOTS = 32;
const MARKED = 'State.Marked';

type UnitFields = {
  kind: 'u8';
  slot: 'u32';
  team: 'u32';
  homeX: 'i64';
  homeZ: 'i64';
};

type RangedFields = { range: 'i64' };

const UNIT_FIELDS: UnitFields = {
  kind: 'u8',
  slot: 'u32',
  team: 'u32',
  homeX: 'i64',
  homeZ: 'i64',
};

const RANGED_FIELDS: RangedFields = { range: 'i64' };

const UnitDef = defineComponent('SkirmishUnit', UNIT_FIELDS);
const RangedDef = defineComponent('SkirmishRanged', RANGED_FIELDS);

const DEFINITIONS = defineAbilitySystem({
  attributes: [
    defineAttribute({
      id: 'Health',
      default: HEALTH,
      min: FP._0,
      max: HEALTH,
      clamp: 'both',
    }),
    defineAttribute({
      id: 'Power',
      default: POWER,
      min: FP._0,
      max: FP.FromInt(50),
      clamp: 'both',
    }),
  ],
  effects: [
    defineEffect({
      id: EFFECT_DAMAGE,
      type: 'Instant',
      modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: DAMAGE }],
    }),
    defineEffect({
      id: 'Effect.StrikeCooldown',
      type: 'Duration',
      durationTicks: COOLDOWN_TICKS,
      tagsGranted: [TAG_COOLDOWN],
    }),
    defineEffect({
      id: EFFECT_BANNER,
      type: 'Duration',
      durationTicks: BANNER_TICKS,
      modifiers: [{ attributeId: 'Power', op: 'Add', magnitude: BANNER_POWER }],
      tagsGranted: [TAG_BANNER],
    }),
    defineEffect({
      id: 'Effect.BannerCooldown',
      type: 'Duration',
      durationTicks: COOLDOWN_TICKS,
      tagsGranted: ['Cooldown.Ability.Banner'],
    }),
  ],
  abilities: [
    defineAbility({
      id: ABILITY_STRIKE,
      target: { kind: 'Entity', origin: { kind: 'Caller' } },
      cooldownEffectId: 'Effect.StrikeCooldown',
      targetEffectIds: [EFFECT_DAMAGE],
      activationBlockedTags: [TAG_COOLDOWN],
    }),
    defineAbility({
      id: ABILITY_BANNER,
      target: { kind: 'Self' },
      cooldownEffectId: 'Effect.BannerCooldown',
      selfEffectIds: [EFFECT_BANNER],
      activationBlockedTags: ['Cooldown.Ability.Banner'],
    }),
  ],
});

interface UnitSpawn {
  slot: number;
  team: number;
  x: bigint;
  z: bigint;
}

const SPAWN_SCRATCH: UnitSpawn = { slot: 0, team: 0, x: 0n, z: 0n };

interface RespawnJob {
  used: boolean;
  at: number;
  kind: number;
  slot: number;
  team: number;
  x: bigint;
  z: bigint;
}

export interface SkirmishConfig extends MatchConfigBase {
  readonly tickLimit: number;
  readonly armySize: number;
}

/** Per-match knobs that are not part of the hashed config. */
export interface SkirmishSession {
  currentPeer: string;
  inject?: { peer: string; afterTick: number; when?: 'restore' | 'tick' };
  spawnOnRestore: boolean;
  throwOnTick?: number;
  throwBot: boolean;
  poolProbe: boolean;
  dirtyAfterRestore: boolean;
  breakBotRestore: boolean;
  /** Sim tick on which a tick-inject fires. -1 until the interpreter arms it. */
  injectTick: number;
  /** Called after `MatchRunner.restore` returns, once the new world exists. */
  poke?: () => void;
  /** Bot memory keyed by peer id, then slot. The canonical dump reads this. */
  bots: Record<string, Record<string, BotNote>>;
}

class UnitComponent extends SoAComponent<UnitFields> {
  public readonly type = UnitDef.type;

  public constructor(entityId: number) {
    super(UnitDef.schema, entityId, {
      kind: 0,
      slot: 0,
      team: 0,
      homeX: 0n,
      homeZ: 0n,
    });
  }

  public write(
    kind: number,
    slot: number,
    team: number,
    x: bigint,
    z: bigint
  ): void {
    const index = this.getIndex();
    if (index < 0) return;
    this.store.arrays.kind[index] = kind;
    this.store.arrays.slot[index] = slot;
    this.store.arrays.team[index] = team;
    this.store.arrays.homeX[index] = x;
    this.store.arrays.homeZ[index] = z;
  }
}

class RangedComponent extends SoAComponent<RangedFields> {
  public readonly type = RangedDef.type;

  public constructor(entityId: number) {
    super(RangedDef.schema, entityId, { range: 0n });
  }

  public write(range: bigint): void {
    const index = this.getIndex();
    if (index < 0) return;
    this.store.arrays.range[index] = range;
  }
}

class PlacedTransform extends TransformComponent {
  public constructor(entityId: number) {
    super(entityId);
  }

  public place(x: bigint, z: bigint): void {
    const index = this.getIndex();
    if (index < 0) return;
    this.store.arrays.fpPositionX[index] = x;
    this.store.arrays.fpPositionY[index] = 0n;
    this.store.arrays.fpPositionZ[index] = z;
  }

  public rawX(): bigint {
    const index = this.getIndex();
    if (index < 0) return 0n;
    return this.store.arrays.fpPositionX[index] ?? 0n;
  }

  public rawZ(): bigint {
    const index = this.getIndex();
    if (index < 0) return 0n;
    return this.store.arrays.fpPositionZ[index] ?? 0n;
  }
}

class PooledUnit extends Entity implements IPoolableEntity<UnitSpawn> {
  public readonly unit: UnitComponent;
  public readonly placed: PlacedTransform;
  private readonly body: PhysicsBodyComponent | null;
  private readonly ranged: RangedComponent | null;

  public constructor(
    private readonly kind: number,
    abilities: AbilitySystem,
    withBody: boolean,
    withRange: boolean
  ) {
    super();
    this.unit = new UnitComponent(this.id);
    this.addComponent(this.unit);
    this.placed = new PlacedTransform(this.id);
    this.addComponent(this.placed);
    if (withBody) {
      this.body = new PhysicsBodyComponent(this.id, {
        radius: RADIUS,
        mass: FP._1,
        restitution: FP._0,
        friction: FP._0,
        useGravity: false,
      });
      this.addComponent(this.body);
    } else {
      this.body = null;
    }
    if (withRange) {
      this.ranged = new RangedComponent(this.id);
      this.addComponent(this.ranged);
    } else {
      this.ranged = null;
    }
    this.addComponent(
      abilities.initComponent({
        attributes: { Health: HEALTH, Power: POWER },
        abilities: [ABILITY_STRIKE, ABILITY_BANNER],
        tags: [TAG_INIT],
      })
    );
  }

  public onSpawn(args: UnitSpawn): void {
    this.unit.write(this.kind, args.slot, args.team, args.x, args.z);
    this.placed.place(args.x, args.z);
    this.body?.stopVelocity();
    if (this.kind === KIND_ARCHER) this.ranged?.write(600000n);
  }

  public onDespawn(): void {
    // Restored live entities never took the prewarm dormant pass, so the
    // first return-to-pool hook would snapshot whatever health and tags
    // they died with. Reset to the factory shell first; the hook then
    // records that, and a respawn matches a peer that never restored.
    const gas = getAbilitySystemComponent(this);
    if (gas === undefined) return;
    const base = gas.attributes.base;
    const current = gas.attributes.current;
    const dirty = gas.attributes.dirty;
    if (base.length > 0 && current.length > 0 && dirty.length > 0) {
      base[0] = HEALTH_RAW;
      current[0] = HEALTH_RAW;
      dirty[0] = 0;
    }
    if (base.length > 1 && current.length > 1 && dirty.length > 1) {
      base[1] = POWER_RAW;
      current[1] = POWER_RAW;
      dirty[1] = 0;
    }
    gas.activeEffects.queue.length = 0;
    gas.activeEffects.pendingAdd.length = 0;
    dropTag(gas.tags, TAG_COOLDOWN);
    dropTag(gas.tags, TAG_BANNER);
    dropTag(gas.tags, BANNER_COOLDOWN);
    if (!gas.abilities.has(ABILITY_STRIKE)) gas.abilities.add(ABILITY_STRIKE);
    if (!gas.abilities.has(ABILITY_BANNER)) gas.abilities.add(ABILITY_BANNER);
  }

  public move(dir: number): void {
    const velocity = VEL[dir];
    if (velocity === undefined || this.body === null) return;
    this.body.setVelocity(velocity[0], FP._0, velocity[1]);
  }
}

function dropTag(
  tags: {
    readonly adHocTags: { delete(tag: string): void };
    readonly effectGrantCounts: { delete(tag: string): void };
    readonly tags: { delete(tag: string): void };
  },
  tag: string
): void {
  tags.adHocTags.delete(tag);
  tags.effectGrantCounts.delete(tag);
  tags.tags.delete(tag);
}

class AuraSystem extends GameSystem {
  public constructor(private readonly sim: SkirmishSim) {
    super();
  }

  public override processTick(_tick: number): void {
    tickAura(this.sim.api);
  }
}

class LifeSystem extends GameSystem {
  public constructor(private readonly sim: SkirmishSim) {
    super();
  }

  public override processTick(tick: number): void {
    this.sim.tickValue = tick;
    if (this.sim.throwOnTick === tick) {
      throw new Error('skirmish tick exploded');
    }
    if (this.sim.probe) {
      this.sim.runProbe(tick);
      return;
    }
    tickLifecycle(this.sim.api, tick);
    this.sim.maybeInject(tick);
  }
}

class SkirmishSim
  implements SimWorld<SkirmishCommand>, CommandView, CommandSink
{
  public tickValue = -1;
  public readonly probe: boolean;
  public readonly throwOnTick: number | undefined;
  public readonly api: GameFacade;
  private readonly jobs: RespawnJob[];
  private readonly injectPeer: boolean;
  private readonly injectOnRestore: boolean;
  private injected = false;
  private freshSignature = '';
  private poolCycles = 0;
  private readonly idScratch: number[] = [];
  private readonly peerId: string;
  private readonly contactKeys: string[] = [];
  private contactTotal = 0;

  public constructor(
    public readonly world: GameWorld,
    public readonly random: IRandom,
    public readonly config: SkirmishConfig,
    private readonly abilities: AbilitySystem,
    private readonly session: SkirmishSession
  ) {
    this.peerId = session.currentPeer;
    // Notes belong to this world's policies. A restored world must not
    // keep the previous world's bot dump if restore forgets to rewrite it.
    session.bots[this.peerId] = {};
    this.probe = session.poolProbe;
    this.throwOnTick = session.throwOnTick;
    this.injectPeer =
      session.inject !== undefined &&
      session.inject.peer === session.currentPeer;
    this.injectOnRestore = session.inject?.when === 'restore';
    session.poke = () => {
      this.pokeLive();
    };
    this.jobs = [];
    for (let index = 0; index < JOB_SLOTS; index += 1) {
      this.jobs.push({
        used: false,
        at: 0,
        kind: 0,
        slot: 0,
        team: 0,
        x: 0n,
        z: 0n,
      });
    }
    this.api = this.createApi();
  }

  public applyCommand(stamped: StampedCommand<SkirmishCommand>): void {
    const slot = stamped.slot;
    applySkirmish(this, stamped.command, slot, this.unitOf(slot));
  }

  public unitOf(slot: number): number | null {
    let found: number | null = null;
    this.eachLive((id) => {
      if (found !== null) return;
      if (this.slotOf(id) === slot) found = id;
    });
    return found;
  }

  public unitsOf(slot: number): number {
    let count = 0;
    this.eachLive((id) => {
      if (this.slotOf(id) === slot) count += 1;
    });
    return count;
  }

  public kindOf(id: number): number {
    return this.field(id, 'kind');
  }

  public teamOf(id: number): number {
    return this.field(id, 'team');
  }

  public slotOf(id: number): number {
    return this.field(id, 'slot');
  }

  public alive(id: number): boolean {
    return this.world.entityManager.getEntity(id) !== undefined;
  }

  public hasTag(id: number, tag: string): boolean {
    return this.abilities.hasTag(id, tag);
  }

  public bodiesTouching(a: number, b: number): boolean {
    if (!this.hasBody(a) || !this.hasBody(b)) return false;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${String(lo)}:${String(hi)}`;
    for (let index = 0; index < this.contactKeys.length; index += 1) {
      if (this.contactKeys[index] === key) return true;
    }
    return false;
  }

  public clearContacts(): void {
    this.contactKeys.length = 0;
  }

  /** Test probe: leave live SoA and match RNG different from the snapshot. */
  public pokeLive(): void {
    if (!this.session.dirtyAfterRestore) return;
    const store = this.world.entityManager.getSoAStore(UnitDef.schema);
    if (store !== undefined) {
      let first: number | undefined;
      for (const id of store.entityIds()) {
        first = id;
        break;
      }
      if (first !== undefined) {
        const index = store.indexOf(first);
        const column = store.arrays.homeZ;
        const value = index < 0 ? undefined : column[index];
        if (value !== undefined) column[index] = value ^ 1n;
      }
    }
    if (!canRewriteRng(this.random)) return;
    const words = this.random.getState().slice();
    const word = words[0];
    if (word === undefined) return;
    words[0] = word ^ 1;
    this.random.setState(words);
  }

  public noteContact(a: number, b: number): void {
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = `${String(lo)}:${String(hi)}`;
    for (let index = 0; index < this.contactKeys.length; index += 1) {
      if (this.contactKeys[index] === key) return;
    }
    this.contactKeys.push(key);
    this.contactTotal += 1;
  }

  public near(a: number, b: number, rangeRaw: bigint): boolean {
    const ax = this.pos(a, 'x');
    const az = this.pos(a, 'z');
    const bx = this.pos(b, 'x');
    const bz = this.pos(b, 'z');
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz <= rangeRaw * rangeRaw;
  }

  public move(id: number, dir: number): void {
    const entity = this.world.entityManager.getEntity(id);
    if (!(entity instanceof PooledUnit)) return;
    entity.move(dir);
  }

  public damage(id: number, source: number): void {
    this.abilities.applyEffect(id, EFFECT_DAMAGE, source);
  }

  public cast(id: number, ability: string, target: number): void {
    this.abilities.activateAbility(id, ability, { entityId: target });
  }

  public spawn(kind: number, slot: number): number {
    const count = this.unitsOf(slot);
    const placed = slotSpawn(slot + count, kind);
    return this.acquire(
      kind,
      slot,
      teamOfSlot(this.config, slot),
      placed.x,
      placed.z
    );
  }

  public recall(id: number): void {
    this.release(id, false);
  }

  public livingTeams(): number {
    let mask = 0;
    this.eachLive((id) => {
      if (this.hp(id) > 0n) mask |= 1 << this.teamOf(id);
    });
    let teams = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((mask & (1 << bit)) !== 0) teams += 1;
    }
    return teams;
  }

  public pendingRespawns(): number {
    let count = 0;
    for (const job of this.jobs) if (job.used) count += 1;
    return count;
  }

  public viewFor(slot: number): BotView {
    const selfId = this.unitOf(slot);
    const self = selfId === null ? null : this.viewOf(selfId);
    const allies: UnitView[] = [];
    const enemies: UnitView[] = [];
    const team = self === null ? teamOfSlot(this.config, slot) : self.team;
    this.eachLive((id) => {
      if (selfId !== null && id === selfId) return;
      const view = this.viewOf(id);
      if (view.team === team) allies.push(view);
      else enemies.push(view);
    });
    return { self, allies, enemies };
  }

  public saveJobs(writer: StateWriter): void {
    const used: RespawnJob[] = [];
    for (const job of this.jobs) if (job.used) used.push(job);
    writer.section('skirmish', 1, (section) => {
      section.list(used, (job, item) => {
        item.u32(job.at);
        item.u8(job.kind);
        item.u32(job.slot);
        item.u32(job.team);
        item.i64(job.x);
        item.i64(job.z);
      });
    });
  }

  public loadJobs(reader: StateReader): void {
    const saved = reader.section('skirmish', (section) =>
      section.list((item) => ({
        at: item.u32(),
        kind: item.u8(),
        slot: item.u32(),
        team: item.u32(),
        x: item.i64(),
        z: item.i64(),
      }))
    );
    for (const job of this.jobs) job.used = false;
    for (
      let index = 0;
      index < saved.length && index < this.jobs.length;
      index += 1
    ) {
      const job = this.jobs[index];
      const row = saved[index];
      if (job === undefined || row === undefined) continue;
      job.used = true;
      job.at = row.at;
      job.kind = row.kind;
      job.slot = row.slot;
      job.team = row.team;
      job.x = row.x;
      job.z = row.z;
    }
    if (this.injectPeer && this.injectOnRestore && !this.injected) {
      this.bumpLowest();
      this.injected = true;
    }
  }

  public maybeInject(tick: number): void {
    if (!this.injectPeer || this.injectOnRestore || this.injected) return;
    if (tick !== this.session.injectTick) return;
    this.bumpLowest();
    this.injected = true;
  }

  public runProbe(tick: number): void {
    const phase = poolPhase(tick);
    if (phase === 'done') return;
    const id = this.lowestId();
    if (id === null) return;
    if (phase === 'capture') {
      this.freshSignature = this.gasSignature(id);
      return;
    }
    if (phase === 'mutate') {
      this.corrupt(id);
      return;
    }
    const kind = this.kindOf(id);
    const slot = this.slotOf(id);
    const team = this.teamOf(id);
    const x = this.home(id, 'x');
    const z = this.home(id, 'z');
    this.release(id, false);
    const again = this.acquire(kind, slot, team, x, z);
    const now = this.gasSignature(again);
    this.poolCycles += 1;
    if (now !== this.freshSignature) {
      throw new Error(
        `pool lifecycle diverged: respawn ${now} != fresh ${this.freshSignature}`
      );
    }
  }

  public stateDump(): {
    entities: Record<string, Record<string, Record<string, string>>>;
    rng: string[];
    gas: Record<string, string>;
    bots: Record<string, Record<string, string>>;
    contacts: string;
  } {
    const entities: Record<string, Record<string, Record<string, string>>> = {};
    this.eachLive((id) => {
      const row: Record<string, Record<string, string>> = {
        SkirmishUnit: sortedFields({
          kind: String(this.kindOf(id)),
          slot: String(this.slotOf(id)),
          team: String(this.teamOf(id)),
          homeX: this.home(id, 'x').toString(),
          homeZ: this.home(id, 'z').toString(),
          x: this.pos(id, 'x').toString(),
          z: this.pos(id, 'z').toString(),
          vx: this.velocity(id, 'x').toString(),
          vz: this.velocity(id, 'z').toString(),
          range: this.rangeOf(id).toString(),
        }),
      };
      const gas = this.gasFields(id);
      if (gas !== null) row['Gas'] = gas;
      entities[String(id)] = row;
    });
    const runtime = this.abilities.exportRuntimeState();
    const notes = this.session.bots[this.peerId] ?? {};
    const bots: Record<string, Record<string, string>> = {};
    for (const slot of Object.keys(notes).sort()) {
      const note = notes[slot];
      if (note === undefined) continue;
      bots[slot] = { phase: note.phase, target: note.target, rng: note.rng };
    }
    return {
      entities,
      rng: generatorWords(this.random),
      gas: sortedFields({
        instanceId: String(runtime.instanceId),
        currentTick: String(runtime.currentTick),
        poolFresh: this.freshSignature,
        poolCycles: String(this.poolCycles),
      }),
      bots,
      contacts: String(this.contactTotal),
    };
  }

  public acquire(
    kind: number,
    slot: number,
    team: number,
    x: bigint,
    z: bigint
  ): number {
    const pools = this.world.pools;
    if (pools === null) throw new Error('skirmish: world has no pools');
    SPAWN_SCRATCH.slot = slot;
    SPAWN_SCRATCH.team = team;
    SPAWN_SCRATCH.x = x;
    SPAWN_SCRATCH.z = z;
    const key =
      kind === KIND_ARCHER
        ? 'archer'
        : kind === KIND_TOTEM
          ? 'totem'
          : 'soldier';
    const entity = pools.spawn<PooledUnit>(key, SPAWN_SCRATCH);
    return entity.id;
  }

  private createApi(): GameFacade {
    return {
      drawRng: () => this.random.int(8),
      eachUnit: (fn) => {
        this.eachLive(fn);
      },
      kindOf: (id) => this.kindOf(id),
      teamOf: (id) => this.teamOf(id),
      slotOf: (id) => this.slotOf(id),
      hp: (id) => this.hp(id),
      hasTag: (id, tag) => this.hasTag(id, tag),
      near: (a, b, range) => this.near(a, b, range),
      bodiesTouching: (a, b) => this.bodiesTouching(a, b),
      contactCount: () => this.contactTotal,
      applyEffect: (target, effectId, source) => {
        this.abilities.applyEffect(target, effectId, source);
      },
      kill: (id, respawn) => {
        this.release(id, respawn);
      },
      flushRespawns: (tick) => {
        this.flush(tick);
      },
      livingTeams: () => this.livingTeams(),
      pendingRespawns: () => this.pendingRespawns(),
      drift: (id, roll, focus) => {
        this.drift(id, roll, focus);
      },
    };
  }

  private release(id: number, respawn: boolean): void {
    const pools = this.world.pools;
    const entity = this.world.entityManager.getEntity(id);
    if (pools === null || entity === undefined) return;
    const kind = this.kindOf(id);
    const slot = this.slotOf(id);
    const team = this.teamOf(id);
    const x = this.home(id, 'x');
    const z = this.home(id, 'z');
    pools.despawn(entity);
    if (!respawn) return;
    for (const job of this.jobs) {
      if (job.used) continue;
      job.used = true;
      job.at = this.tickValue + RESPAWN_DELAY;
      job.kind = kind;
      job.slot = slot;
      job.team = team;
      job.x = x;
      job.z = z;
      return;
    }
  }

  private flush(tick: number): void {
    for (const job of this.jobs) {
      if (!job.used || job.at > tick) continue;
      job.used = false;
      this.acquire(job.kind, job.slot, job.team, job.x, job.z);
    }
  }

  private eachLive(fn: (id: number) => void): void {
    const store = this.world.entityManager.getSoAStore(UnitDef.schema);
    if (store === undefined) return;
    const scratch = this.idScratch;
    scratch.length = 0;
    for (const id of store.entityIds()) scratch.push(id);
    for (let index = 0; index < scratch.length; index += 1) {
      const id = scratch[index];
      if (id !== undefined) fn(id);
    }
  }

  private field(id: number, name: 'kind' | 'slot' | 'team'): number {
    const store = this.world.entityManager.getSoAStore(UnitDef.schema);
    if (store === undefined) return 0;
    const index = store.indexOf(id);
    if (index < 0) return 0;
    const value = store.arrays[name][index];
    return value ?? 0;
  }

  private home(id: number, axis: 'x' | 'z'): bigint {
    const store = this.world.entityManager.getSoAStore(UnitDef.schema);
    if (store === undefined) return 0n;
    const index = store.indexOf(id);
    if (index < 0) return 0n;
    const column = axis === 'x' ? store.arrays.homeX : store.arrays.homeZ;
    return column[index] ?? 0n;
  }

  private pos(id: number, axis: 'x' | 'z'): bigint {
    const entity = this.world.entityManager.getEntity(id);
    if (!(entity instanceof PooledUnit)) return 0n;
    return axis === 'x' ? entity.placed.rawX() : entity.placed.rawZ();
  }

  private rangeOf(id: number): bigint {
    const store = this.world.entityManager.getSoAStore(RangedDef.schema);
    if (store === undefined) return 0n;
    const index = store.indexOf(id);
    if (index < 0) return 0n;
    return store.arrays.range[index] ?? 0n;
  }

  private velocity(id: number, axis: 'x' | 'z'): bigint {
    const store = this.world.entityManager.getSoAStore(PhysicsSoASchema);
    if (store === undefined) return 0n;
    const index = store.indexOf(id);
    if (index < 0) return 0n;
    const column =
      axis === 'x' ? store.arrays.velocityX : store.arrays.velocityZ;
    return column[index] ?? 0n;
  }

  private hasBody(id: number): boolean {
    const entity = this.world.entityManager.getEntity(id);
    return entity?.hasComponent(PHYSICS_BODY_COMPONENT_TYPE) ?? false;
  }

  private drift(id: number, roll: number, focus: boolean): void {
    const store = this.world.entityManager.getSoAStore(UnitDef.schema);
    if (store === undefined) return;
    const index = store.indexOf(id);
    if (index < 0) return;
    const homeX = store.arrays.homeX[index] ?? 0n;
    const homeZ = store.arrays.homeZ[index] ?? 0n;
    store.arrays.homeX[index] = homeX + 1n;
    store.arrays.homeZ[index] = homeZ + BigInt(roll + 1);
    const ranged = this.world.entityManager.getSoAStore(RangedDef.schema);
    const rangedIndex = ranged?.indexOf(id) ?? -1;
    if (ranged !== undefined && rangedIndex >= 0) {
      const range = ranged.arrays.range[rangedIndex] ?? 0n;
      ranged.arrays.range[rangedIndex] = range + BigInt(roll + 1);
    }
    this.stampVelocity(id);
    if (!focus) return;
    const entity = this.world.entityManager.getEntity(id);
    if (entity === undefined) return;
    const gas = getAbilitySystemComponent(entity);
    const current = gas?.attributes.current[0];
    const base = gas?.attributes.base[0];
    if (gas === undefined || current === undefined || base === undefined)
      return;
    gas.attributes.base[0] = base + 1n;
    gas.attributes.current[0] = current + 1n;
    gas.attributes.dirty[0] = 0;
  }

  private stampVelocity(id: number): void {
    const store = this.world.entityManager.getSoAStore(PhysicsSoASchema);
    if (store === undefined) return;
    const index = store.indexOf(id);
    if (index < 0) return;
    const step = BigInt((this.tickValue % 5) + 1) * 20000n;
    store.arrays.velocityX[index] = step;
    store.arrays.velocityZ[index] = step;
  }

  private hp(id: number): bigint {
    const entity = this.world.entityManager.getEntity(id);
    if (entity === undefined) return 0n;
    const gas = getAbilitySystemComponent(entity);
    return gas?.attributes.current[0] ?? 0n;
  }

  private viewOf(id: number): UnitView {
    return {
      id,
      kind: this.kindOf(id),
      slot: this.slotOf(id),
      team: this.teamOf(id),
      x: this.pos(id, 'x'),
      z: this.pos(id, 'z'),
      hp: this.hp(id),
    };
  }

  private lowestId(): number | null {
    let found: number | null = null;
    this.eachLive((id) => {
      if (found === null) found = id;
    });
    return found;
  }

  private bumpLowest(): void {
    const id = this.lowestId();
    if (id === null) return;
    const entity = this.world.entityManager.getEntity(id);
    if (entity === undefined) return;
    const gas = getAbilitySystemComponent(entity);
    const current = gas?.attributes.current[0];
    const base = gas?.attributes.base[0];
    if (gas === undefined || current === undefined || base === undefined)
      return;
    gas.attributes.base[0] = base + 1n;
    gas.attributes.current[0] = current + 1n;
    // Settled value. A dirty flag would be recomputed and clamped next tick.
    gas.attributes.dirty[0] = 0;
  }

  private corrupt(id: number): void {
    const entity = this.world.entityManager.getEntity(id);
    if (entity === undefined) return;
    const gas = getAbilitySystemComponent(entity);
    if (gas === undefined) return;
    gas.attributes.base[0] = 1n;
    gas.attributes.current[0] = 1n;
    gas.attributes.dirty[0] = 1;
    this.abilities.addTag(id, MARKED);
  }

  private gasSignature(id: number): string {
    const entity = this.world.entityManager.getEntity(id);
    if (entity === undefined) return 'missing';
    const gas = getAbilitySystemComponent(entity);
    if (gas === undefined) return 'nogas';
    const hp = gas.attributes.current[0] ?? 0n;
    const power = gas.attributes.current[1] ?? 0n;
    const tags = [...gas.tags.tags].sort().join(',');
    const abilities = [...gas.abilities].sort().join(',');
    return `${hp.toString()}|${power.toString()}|${tags}|${abilities}`;
  }

  private gasFields(id: number): Record<string, string> | null {
    const entity = this.world.entityManager.getEntity(id);
    if (entity === undefined) return null;
    const gas = getAbilitySystemComponent(entity);
    if (gas === undefined) return null;
    return sortedFields({
      health: (gas.attributes.current[0] ?? 0n).toString(),
      power: (gas.attributes.current[1] ?? 0n).toString(),
      tags: [...gas.tags.tags].sort().join(','),
      abilities: [...gas.abilities].sort().join(','),
    });
  }
}

class ClearContacts extends GameSystem {
  public constructor(private readonly sim: SkirmishSim) {
    super();
  }

  public override processTick(_tick: number): void {
    this.sim.clearContacts();
  }
}

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
    if (this.session.throwBot && tick === 2) {
      throw new Error('bot exploded');
    }
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

export function createSkirmishGame(
  session: SkirmishSession
): ReturnType<typeof defineGame<SkirmishConfig, SkirmishCommand, SkirmishSim>> {
  return defineGame({
    id: 'skirmish',
    simVersion: 'skirmish-1',
    tickRate: 10,
    createWorld: (config, ctx: WorldInitContext): SkirmishSim => {
      const holder: { abilities?: AbilitySystem } = {};
      const army = config.armySize;
      const soldierPool = army > 0 ? army : config.slots.length + 8;
      const world = new GameWorld({
        tickFrameProvider: ctx.tickFrameProvider,
        random: ctx.random,
        tickRate: 10,
        pooling: {
          entityTypes: {
            soldier: {
              factory: () => buildUnit(KIND_SOLDIER, holder, true, false),
              pool: { initialSize: soldierPool },
            },
            archer: {
              factory: () => buildUnit(KIND_ARCHER, holder, true, true),
              pool: { initialSize: army > 0 ? 1 : 6 },
            },
            totem: {
              factory: () => buildUnit(KIND_TOTEM, holder, false, false),
              pool: { initialSize: army > 0 ? 1 : 4 },
            },
          },
        },
      });
      world.registerComponent(UnitDef);
      world.registerComponent(RangedDef);
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
        ctx.random,
        config,
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
      world.start();
      physics.onCollision((event: CollisionEvent) => {
        sim.noteContact(event.entityA, event.entityB);
      });
      const spawn = ctx.purpose === 'fresh' || session.spawnOnRestore;
      if (spawn) spawnRoster(sim, config);
      return sim;
    },
    commands: {
      types: ['move', 'attack', 'cast', 'spawn', 'recall'],
      decode: (raw): SkirmishCommand | CommandRejection => decodeCommand(raw),
      validate: (command, slot, sim) => {
        const reason = rejectReason(sim, command, slot.slot);
        return reason === null ? null : rejectCommand(reason);
      },
      encode: (command): JsonValue => command,
    },
    state: undefined,
    bots: {
      aggressive: (_config, slot: BotSlotInfo, rng: IRandom) =>
        new Policy(slot.slot, rng, true, session),
      defensive: (_config, slot: BotSlotInfo, rng: IRandom) =>
        new Policy(slot.slot, rng, false, session),
    },
    outcome: (sim) => {
      if (sim.tickValue + 1 >= sim.config.tickLimit) {
        return { kind: 'draw', reason: 'tick limit' };
      }
      return null;
    },
  });
}

function buildUnit(
  kind: number,
  holder: { abilities?: AbilitySystem },
  withBody: boolean,
  withRange: boolean
): PooledUnit {
  const abilities = holder.abilities;
  if (abilities === undefined)
    throw new Error('skirmish: ability system is not ready');
  return new PooledUnit(kind, abilities, withBody, withRange);
}

function spawnRoster(sim: SkirmishSim, config: SkirmishConfig): void {
  if (config.armySize > 0) {
    for (let index = 0; index < config.armySize; index += 1) {
      const placed = armySpawn(index);
      sim.acquire(KIND_SOLDIER, placed.slot, placed.team, placed.x, placed.z);
    }
    return;
  }
  for (const slot of config.slots) {
    const placed = slotSpawn(slot.slot, KIND_SOLDIER);
    sim.acquire(KIND_SOLDIER, slot.slot, slot.team, placed.x, placed.z);
  }
  const first = config.slots[0];
  if (first !== undefined) {
    const archer = slotSpawn(first.slot, KIND_ARCHER);
    const totem = slotSpawn(first.slot, KIND_TOTEM);
    sim.acquire(KIND_ARCHER, first.slot, first.team, archer.x, archer.z);
    sim.acquire(KIND_TOTEM, first.slot, first.team, totem.x, totem.z);
  }
}

function teamOfSlot(config: SkirmishConfig, slot: number): number {
  for (const entry of config.slots) {
    if (entry.slot === slot) return entry.team;
  }
  return 0;
}

function decodeCommand(raw: unknown): SkirmishCommand | CommandRejection {
  if (typeof raw !== 'object' || raw === null)
    return rejectCommand('not an object');
  const value = raw as {
    type?: unknown;
    dir?: unknown;
    target?: unknown;
    ability?: unknown;
    kind?: unknown;
  };
  if (value.type === 'move' && isInt(value.dir, 0, 3)) {
    return { type: 'move', dir: value.dir };
  }
  if (value.type === 'attack' && isInt(value.target, 1, 1_000_000)) {
    return { type: 'attack', target: value.target };
  }
  if (
    value.type === 'cast' &&
    isInt(value.ability, 0, 1) &&
    isInt(value.target, 1, 1_000_000)
  ) {
    return { type: 'cast', ability: value.ability, target: value.target };
  }
  if (value.type === 'spawn' && isInt(value.kind, KIND_SOLDIER, KIND_TOTEM)) {
    return { type: 'spawn', kind: value.kind };
  }
  if (value.type === 'recall') return { type: 'recall' };
  return rejectCommand('unknown command');
}

function isInt(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function sortedFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(fields).sort()) {
    const value = fields[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function generatorWords(random: IRandom): string[] {
  if (!hasState(random)) return [];
  return random.getState().map((word) => String(word));
}

function hasState(
  random: IRandom
): random is IRandom & { getState(): readonly number[] } {
  if (!('getState' in random)) return false;
  const candidate: unknown = random.getState;
  return typeof candidate === 'function';
}

function canRewriteRng(random: IRandom): random is IRandom & {
  getState(): readonly number[];
  setState(state: readonly number[]): void;
} {
  if (!hasState(random)) return false;
  if (!('setState' in random)) return false;
  const candidate: unknown = random.setState;
  return typeof candidate === 'function';
}
