/**
 * Engine binding for the skirmish sim: SoA components, pooled archetypes,
 * and the tick systems. Pure rules and bot decisions live in
 * `game/skirmish/` and do not import the engine. `facade/v65.ts` only
 * builds the `defineGame` definition on top of this module.
 */
import {
  Entity,
  GameSystem,
  GameWorld,
  SoAComponent,
  defineComponent,
  despawn,
  each,
  type IPoolableEntity,
  type IRandom,
  type MatchConfigBase,
  type StateReader,
  type StateWriter,
} from '@phalanx-engine/game';
import {
  defineAbility,
  defineAbilitySystem,
  defineAttribute,
  defineEffect,
  getAbilitySystemComponent,
  type AbilitySystem,
} from '@phalanx-engine/game/abilities';
import { FP, type FixedPoint } from '@phalanx-engine/game/math';
import {
  PHYSICS_BODY_COMPONENT_TYPE,
  PhysicsBodyComponent,
  PhysicsSoASchema,
  TransformComponent,
  TransformSoASchema,
} from '@phalanx-engine/game/physics';
import type { BotNote, BotView, GameFacade, UnitView } from './GameFacade.js';
import { contactsInclude, rememberContact } from '../game/skirmish/contacts.js';
import {
  driftedHome,
  driftedRange,
  driftVelocity,
  focusedHealth,
} from '../game/skirmish/drift.js';
import {
  emptyJobs,
  flushRespawns,
  RESPAWN_DELAY,
  loadJobs,
  pendingRespawns,
  scheduleRespawn,
  usedJobs,
  type RespawnJob,
} from '../game/skirmish/jobs.js';
import { poolPhase } from '../game/skirmish/pool.js';
import { slotSpawn } from '../game/skirmish/roster.js';
import {
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
  KIND_TOTEM,
  TAG_BANNER,
  TAG_COOLDOWN,
  TAG_INIT,
} from '../game/skirmish/types.js';

const HEALTH = FP.FromInt(100);
const POWER = FP.FromInt(10);
const HEALTH_RAW = FP.ToRaw(HEALTH);
const POWER_RAW = FP.ToRaw(POWER);
const BANNER_COOLDOWN = 'Cooldown.Ability.Banner';
const RADIUS = FP.FromInt(1);
export const CELL = FP.FromInt(4);
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
const MARKED = 'State.Marked';
const ARCHER_RANGE = 600000n;

export const UnitDef = defineComponent('SkirmishUnit', {
  kind: 'u8',
  slot: 'u32',
  team: 'u32',
  homeX: 'i64',
  homeZ: 'i64',
  eid: 'u32',
});
export const RangedDef = defineComponent('SkirmishRanged', { range: 'i64' });

export const DEFINITIONS = defineAbilitySystem({
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

export interface SkirmishConfig extends MatchConfigBase {
  readonly tickLimit: number;
  readonly armySize: number;
}

export interface BoundSim {
  readonly world: GameWorld;
  stateDump(): {
    entities: Record<string, Record<string, Record<string, string>>>;
    rng: string[];
    gas: Record<string, string>;
    bots: Record<string, Record<string, string>>;
    contacts: string;
  };
}

/** Per-match knobs that are not part of the hashed config. */
export interface SkirmishSession {
  currentPeer: string;
  inject?: { peer: string; afterTick: number; when?: 'restore' | 'tick' };
  spawnOnRestore: boolean;
  throwOnTick?: number;
  suppressThrow: boolean;
  throwBot: boolean;
  poolProbe: boolean;
  dirtyAfterRestore: boolean;
  breakBotRestore: boolean;
  /** Restore writes a field, so the snapshot round-trip check fails. */
  corruptOnRestore: boolean;
  injectTick: number;
  poke?: () => void;
  bots: Record<string, Record<string, BotNote>>;
  bound: Record<string, BoundSim>;
  controls: {
    slot: number;
    mode: 'human' | 'bot';
    fromTick: number;
  }[];
}

class UnitComponent extends SoAComponent<{
  kind: 'u8';
  slot: 'u32';
  team: 'u32';
  homeX: 'i64';
  homeZ: 'i64';
  eid: 'u32';
}> {
  public readonly type = UnitDef.type;

  public constructor(entityId: number) {
    super(UnitDef.schema, entityId, {
      kind: 0,
      slot: 0,
      team: 0,
      homeX: 0n,
      homeZ: 0n,
      eid: 0,
    });
  }

  public write(
    kind: number,
    slot: number,
    team: number,
    x: bigint,
    z: bigint,
    eid: number
  ): void {
    const index = this.getIndex();
    if (index < 0) return;
    this.store.arrays.kind[index] = kind;
    this.store.arrays.slot[index] = slot;
    this.store.arrays.team[index] = team;
    this.store.arrays.homeX[index] = x;
    this.store.arrays.homeZ[index] = z;
    this.store.arrays.eid[index] = eid;
  }
}

class RangedComponent extends SoAComponent<{ range: 'i64' }> {
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
  public place(x: bigint, z: bigint): void {
    const index = this.getIndex();
    if (index < 0) return;
    this.store.arrays.fpPositionX[index] = x;
    this.store.arrays.fpPositionY[index] = 0n;
    this.store.arrays.fpPositionZ[index] = z;
  }
}

class PooledUnit extends Entity implements IPoolableEntity<UnitSpawn> {
  public readonly unit: UnitComponent;
  public readonly placed: PlacedTransform;
  private readonly body: PhysicsBodyComponent | null;
  private readonly ranged: RangedComponent | null;

  public constructor(
    id: number,
    private readonly kind: number,
    abilities: AbilitySystem,
    withBody: boolean,
    withRange: boolean
  ) {
    super(id);
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
    this.unit.write(this.kind, args.slot, args.team, args.x, args.z, this.id);
    this.placed.place(args.x, args.z);
    this.body?.stopVelocity();
    if (this.kind === KIND_ARCHER) this.ranged?.write(ARCHER_RANGE);
  }

  public onDespawn(): void {
    // Restore builds a new entity object for a live unit, so that object
    // never took the prewarm pass. The return-to-pool hook records its
    // shell on the first despawn. Install the factory image first; the
    // hook then copies that, and a respawn matches a peer that never
    // restored.
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

export class AuraSystem extends GameSystem {
  public constructor(private readonly sim: SkirmishSim) {
    super();
  }

  public override processTick(_tick: number): void {
    tickAura(this.sim.api);
  }
}

export class LifeSystem extends GameSystem {
  public constructor(private readonly sim: SkirmishSim) {
    super();
  }

  public override processTick(tick: number): void {
    this.sim.tickValue = tick;
    if (this.sim.throwOnTick === tick && !this.sim.suppressThrow) {
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

export class ClearContacts extends GameSystem {
  public constructor(private readonly sim: SkirmishSim) {
    super();
  }

  public override processTick(_tick: number): void {
    this.sim.contactKeys.length = 0;
  }
}

export class SkirmishSim implements CommandView, CommandSink {
  public tickValue = -1;
  public readonly probe: boolean;
  public readonly throwOnTick: number | undefined;
  public readonly suppressThrow: boolean;
  public readonly api: GameFacade;
  public readonly contactKeys: string[] = [];
  private readonly jobs: RespawnJob[];
  private readonly injectPeer: boolean;
  private readonly injectOnRestore: boolean;
  private injected = false;
  private freshSignature = '';
  private poolCycles = 0;
  private readonly idScratch: number[] = [];
  private readonly peerId: string;
  private contactTotal = 0;

  public constructor(
    public readonly world: GameWorld,
    public readonly random: IRandom,
    public readonly config: SkirmishConfig,
    private readonly abilities: AbilitySystem,
    private readonly session: SkirmishSession
  ) {
    this.peerId = session.currentPeer;
    session.bots[this.peerId] = {};
    session.bound[this.peerId] = this;
    this.probe = session.poolProbe;
    this.throwOnTick = session.throwOnTick;
    this.suppressThrow = session.suppressThrow;
    this.injectPeer =
      session.inject !== undefined &&
      session.inject.peer === session.currentPeer;
    this.injectOnRestore = session.inject?.when === 'restore';
    session.poke = () => {
      this.pokeLive();
    };
    this.jobs = emptyJobs();
    this.api = {
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
        flushRespawns(this.jobs, tick, (job) => {
          this.acquire(job.kind, job.slot, job.team, job.x, job.z);
        });
      },
      livingTeams: () => this.livingTeams(),
      pendingRespawns: () => pendingRespawns(this.jobs),
      drift: (id, roll, focus) => {
        this.drift(id, roll, focus);
      },
    };
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
    return contactsInclude(this.contactKeys, a, b);
  }

  public noteContact(a: number, b: number): void {
    if (rememberContact(this.contactKeys, a, b)) this.contactTotal += 1;
  }

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

  public saveJobs(writer: StateWriter): void {
    writer.section('skirmish', 1, (section) => {
      section.list(usedJobs(this.jobs), (job, item) => {
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
    loadJobs(this.jobs, saved);
    if (this.session.corruptOnRestore) this.bumpLowest();
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
    if (!this.probe) return;
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

  public stateDump(): ReturnType<BoundSim['stateDump']> {
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
    const placed = slotSpawn(slot + this.unitsOf(slot), kind);
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
    return pools.spawn<PooledUnit>(key, SPAWN_SCRATCH).id;
  }

  private livingTeams(): number {
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

  private release(id: number, respawn: boolean): void {
    const entity = this.world.entityManager.getEntity(id);
    if (entity === undefined) return;
    const kind = this.kindOf(id);
    const slot = this.slotOf(id);
    const team = this.teamOf(id);
    const x = this.home(id, 'x');
    const z = this.home(id, 'z');
    despawn(this.world, entity);
    if (!respawn) return;
    scheduleRespawn(
      this.jobs,
      this.tickValue + RESPAWN_DELAY,
      kind,
      slot,
      team,
      x,
      z
    );
  }

  private eachLive(fn: (id: number) => void): void {
    const scratch = this.idScratch;
    scratch.length = 0;
    each(this.world, UnitDef, (view) => {
      scratch.push(view.eid);
    });
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
    const store = this.world.entityManager.getSoAStore(TransformSoASchema);
    if (store === undefined) return 0n;
    const index = store.indexOf(id);
    if (index < 0) return 0n;
    const column =
      axis === 'x' ? store.arrays.fpPositionX : store.arrays.fpPositionZ;
    return column[index] ?? 0n;
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
    store.arrays.homeX[index] = driftedHome(homeX, roll, 'x');
    store.arrays.homeZ[index] = driftedHome(homeZ, roll, 'z');
    const ranged = this.world.entityManager.getSoAStore(RangedDef.schema);
    const rangedIndex = ranged?.indexOf(id) ?? -1;
    if (ranged !== undefined && rangedIndex >= 0) {
      const range = ranged.arrays.range[rangedIndex] ?? 0n;
      ranged.arrays.range[rangedIndex] = driftedRange(range, roll);
    }
    this.stampVelocity(id);
    if (!focus) return;
    const gas = gasOf(this.world, id);
    if (gas === undefined) return;
    const current = gas.attributes.current[0];
    const base = gas.attributes.base[0];
    if (current === undefined || base === undefined) return;
    gas.attributes.base[0] = focusedHealth(base);
    gas.attributes.current[0] = focusedHealth(current);
    gas.attributes.dirty[0] = 0;
  }

  private stampVelocity(id: number): void {
    const store = this.world.entityManager.getSoAStore(PhysicsSoASchema);
    if (store === undefined) return;
    const index = store.indexOf(id);
    if (index < 0) return;
    const step = driftVelocity(this.tickValue);
    store.arrays.velocityX[index] = step;
    store.arrays.velocityZ[index] = step;
  }

  private hp(id: number): bigint {
    return gasOf(this.world, id)?.attributes.current[0] ?? 0n;
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
    const gas = gasOf(this.world, id);
    const current = gas?.attributes.current[0];
    const base = gas?.attributes.base[0];
    if (gas === undefined || current === undefined || base === undefined) {
      return;
    }
    gas.attributes.base[0] = focusedHealth(base);
    gas.attributes.current[0] = focusedHealth(current);
    gas.attributes.dirty[0] = 0;
  }

  private corrupt(id: number): void {
    const gas = gasOf(this.world, id);
    if (gas === undefined) return;
    gas.attributes.base[0] = 1n;
    gas.attributes.current[0] = 1n;
    gas.attributes.dirty[0] = 1;
    this.abilities.addTag(id, MARKED);
  }

  private gasSignature(id: number): string {
    const gas = gasOf(this.world, id);
    if (gas === undefined) return 'nogas';
    const hp = gas.attributes.current[0] ?? 0n;
    const power = gas.attributes.current[1] ?? 0n;
    const tags = [...gas.tags.tags].sort().join(',');
    const abilities = [...gas.abilities].sort().join(',');
    return `${hp.toString()}|${power.toString()}|${tags}|${abilities}`;
  }

  private gasFields(id: number): Record<string, string> | null {
    const gas = gasOf(this.world, id);
    if (gas === undefined) return null;
    return sortedFields({
      health: (gas.attributes.current[0] ?? 0n).toString(),
      power: (gas.attributes.current[1] ?? 0n).toString(),
      tags: [...gas.tags.tags].sort().join(','),
      abilities: [...gas.abilities].sort().join(','),
    });
  }

  public near(a: number, b: number, rangeRaw: bigint): boolean {
    const dx = this.pos(a, 'x') - this.pos(b, 'x');
    const dz = this.pos(a, 'z') - this.pos(b, 'z');
    return dx * dx + dz * dz <= rangeRaw * rangeRaw;
  }
}

export function buildUnit(
  id: number,
  kind: number,
  holder: { abilities?: AbilitySystem },
  withBody: boolean,
  withRange: boolean
): PooledUnit {
  const abilities = holder.abilities;
  if (abilities === undefined) {
    throw new Error('skirmish: ability system is not ready');
  }
  return new PooledUnit(id, kind, abilities, withBody, withRange);
}

function teamOfSlot(config: SkirmishConfig, slot: number): number {
  for (const entry of config.slots) {
    if (entry.slot === slot) return entry.team;
  }
  return 0;
}

function gasOf(world: GameWorld, id: number) {
  const entity = world.entityManager.getEntity(id);
  if (entity === undefined) return undefined;
  return getAbilitySystemComponent(entity);
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

export function hasState(
  random: IRandom
): random is IRandom & { getState(): readonly number[] } {
  if (!('getState' in random)) return false;
  return typeof random.getState === 'function';
}

function canRewriteRng(random: IRandom): random is IRandom & {
  getState(): readonly number[];
  setState(state: readonly number[]): void;
} {
  if (!hasState(random)) return false;
  if (!('setState' in random)) return false;
  return typeof random.setState === 'function';
}
