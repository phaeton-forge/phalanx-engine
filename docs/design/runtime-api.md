# `@phalanx-engine/runtime` API (engine 0.3)

## Task 6.5b (current)

This section supersedes earlier names in this document. The code wins where
they still disagree.

A game is `defineComponent` + `defineCommands` + `defineGame` + `runLocalMatch`.
There is no hand-written command codec and no `SimWorld.applyCommand`.

| Removed                    | Replacement                                                                      |
| -------------------------- | -------------------------------------------------------------------------------- |
| `createWorld`              | `onStart(ctx)`; the engine owns `GameWorld`. `ctx.open()` prewarms and starts it |
| `applyCommand`             | `onCommand` (function or exhaustive handler map)                                 |
| `outcome`                  | `checkOutcome`                                                                   |
| `GameState` / `state.bind` | `SaveHandler` and `save: { handler }` in `@phalanx-engine/runtime/advanced`      |
| `CommandSchema`            | `defineCommands`; the hand-written type stays in `advanced`                      |
| `LocalTransport.manual`    | `LocalTransport.stepped`                                                         |
| `simMode` + runner `side`  | one `side` on the match config. `runsOn` is not required to equal `side`         |
| `MatchRunner.fromReplay`   | `ReplayPlayer.from`                                                              |

`defineCommands` field types: `i32`, `u32`, `u8`, `i64`, `bool`, `entity`,
`string` (default max length 64). `decode` returns a rejection and does not
throw. `encode` uses canonical key order. `i64` is a decimal string on the
wire. The command schema is appended to `configHash` after component records.
`side` is not part of `configHash`. `ENGINE_SNAPSHOT_FORMAT` is 2; a format-1
snapshot fails with `unsupported engine snapshot format 1; expected 2`.

`runLocalMatch(def, { seed, slots, stepped?, inputDelayTicks? })` returns
`{ runner, transport, step }`. Short slots (`{ kind: 'human' }`,
`{ kind: 'bot', policy }`) are expanded. `inputDelayTicks` defaults to 2.
`gameId` and `simVersion` are filled from the definition; a provided mismatch
is still rejected.

`ReplayPlayer.from(def, replay)` exposes `play({ budgetMs })`,
`fastForward(throughTick)`, `digest()`, `tick` and `onTick`. It has no
`start` or `submit`. A final-digest mismatch throws.

`runner.setController(slot, 'human' | 'bot', { fromTick?, policy? })` logs a
system command (player id `system`, not a game command). It is applied at the
start of `fromTick` (default `tick + inputDelayTicks`), before game commands,
on live play, restore, `ReplayPlayer` and `fastForward`. Switching to the
current mode, an unknown slot, or a `fromTick` outside
`(current, current + inputDelayTicks]` is rejected via `onRejected` and is
not logged. A human command for a bot-controlled slot is rejected with
`slot controlled by bot`. Handover to a bot seeds RNG with `botSlotSeed(seed, slot)`.
The payload `runsOn` comes from the bot slot, or is `server` when this runner
has a server peer (`side: 'server'` or transport kind `server-peer`) and
`local` otherwise. A peer that does not host that `runsOn` rejects the call
with `not authoritative`. The input checkpoint stores the next system `q` outside the digest, so a
new runner restored after an applied controller change does not reuse it. `start` throws
when a slot has `runsOn: 'server'` and the match has no server peer.

`GameSystem.world` is the world. `each` passes one reused view; do not store
it; a write after despawn throws. Importing `@phalanx-engine/runtime` installs
the world-module host. Without it, save/restore/spawn/despawn/each throw
`GameWorld: world modules are not installed. Import @phalanx-engine/runtime before using save, restore, spawn, despawn, or each.`

`@phalanx-engine/game` re-exports the game-facing surface. The root is
runtime plus the explicit ecs list. `/math`, `/physics` and `/abilities`
are separate subpaths. Fixed-point math is only on `/math`. Advanced
helpers are `@phalanx-engine/game/advanced`.

Initial GAS `pendingAdd` effects are captured on the first pool return and
copied back by `AbilitySystemComponent.onEnable`. `world.restore` calls
`onEnable('restore')` and does not reseed.

`spawnWithId` throws `spawnWithId: entity N already exists` when that id is
already registered.

Sections below this one were written in Tasks 1–6.5a. Where they still say
`createWorld`, `applyCommand`, `outcome`, `GameState`, `state.bind`,
`simMode`, `LocalTransport.manual` or `MatchRunner.fromReplay`, use the table
above.

Status: contracts and skeleton committed in Task 1. Every signature below is
copied from `phalanx-runtime/src`; when the two differ, the code wins and
this document has a bug. Skeleton members throw
`not implemented: <member> (Task NN)` (`NotImplementedError`) until the task
in the [task map](#task-map) lands. Implemented now: `defineGame`,
`defineCommands`, `runLocalMatch`, `ReplayPlayer`, the constants,
`botPlayerId` / `isBotPlayerId`, `botSlotSeed`, `rejectCommand` /
`isCommandRejection`.

Related: [server-sim.md](./server-sim.md), [reconnect.md](./reconnect.md).

Contents:

1. [Game definition](#1-game-definition)
2. [Match config and slots](#2-match-config-and-slots)
3. [Commands](#3-commands)
4. [GameState contract (approved)](#4-gamestate-contract-approved)
5. [Snapshot header, layout and version policy](#5-snapshot-header-layout-and-version-policy)
6. [StateHelpers (optional)](#6-statehelpers-optional)
7. [Bots](#7-bots)
8. [MatchRunner, CommandLog, WorldScope, replays](#8-matchrunner-commandlog-worldscope-replays)
9. [Transport](#9-transport)
10. [Examples](#10-examples)
11. [Review & corrections](#review--corrections)
12. [Corrections for later tasks](#corrections-for-later-tasks)
13. [Task map](#task-map)
14. [Decisions](#decisions-andrey-2026-10-14)

---

## 1. Game definition

`src/game/GameDefinition.ts`, `src/game/defineGame.ts`.

```ts
export interface WorldInitContext {
  /** Runner-owned provider. Ticks carry an empty `CommandsBatch`. */
  readonly tickFrameProvider: ITickFrameProvider;
  /** Match RNG seeded from `config.seed`. */
  readonly random: IRandom;
  /** 'fresh': build the tick-0 world. 'restore': static content only. */
  readonly purpose: 'fresh' | 'restore';
}

export interface SimWorld<Cmd extends GameCommand = GameCommand> {
  readonly world: GameWorld;
  /** Called inside the tick, before the tick systems, in canonical order. */
  applyCommand(command: StampedCommand<Cmd>): void;
  dispose?(): void;
}

export type MatchOutcome =
  | { readonly kind: 'win'; readonly winnerTeam: number; readonly reason: string }
  | { readonly kind: 'draw'; readonly reason: string };

export interface GameDefinition<
  Cfg extends MatchConfigBase = MatchConfigBase,
  Cmd extends GameCommand = GameCommand,
  Sim extends SimWorld<Cmd> = SimWorld<Cmd>,
> {
  readonly id: string; // = server gameTypes[].gameType
  readonly simVersion: string; // changes on any sim change
  readonly tickRate: number; // integer; = server tickRate
  createWorld(config: Cfg, ctx: WorldInitContext): Sim;
  readonly commands: CommandSchema<Cmd, Sim>;
  readonly state: GameStateSpec<Sim>;
  readonly bots?: Readonly<Record<string, BotPolicyFactory<Cfg, Cmd, Sim>>>;
  /** Pure; null while running. Called after every tick. */
  outcome(sim: Readonly<Sim>): MatchOutcome | null;
}

export type AnyGameDefinition = GameDefinition<MatchConfigBase, GameCommand, SimWorld>;
export type ConfigOf<G>; export type CommandOf<G>; export type SimOf<G>;

export function defineGame<Cfg, Cmd, Sim>(
  def: Omit<GameDefinition<Cfg, Cmd, Sim>, 'state'> & {
    readonly state?: GameStateSpec<Sim>;
  }
): GameDefinition<Cfg, Cmd, Sim>;
```

`defineGame` throws `defineGame: …` errors when `id` / `simVersion` are not
non-empty strings, `tickRate` is not a positive integer, `createWorld` /
`outcome` are not functions, `commands` lacks a `types` array or a `decode`
function, a provided `state` lacks a positive-integer `formatVersion` or a
`bind` function, or a `bots` entry is not a function. When `state` is
present it returns that same object. When `state` is omitted it returns a
copy whose state is the world modules (`formatVersion` 1): `save` / `restore`
call `world.save` / `world.restore`.

**World construction rule.** `createWorld` MUST build its `GameWorld` with
`{ tickFrameProvider: ctx.tickFrameProvider, random: ctx.random }` and call
`world.start(hooks)` before returning. `tickFrameProvider` is required.
`GameWorld` does not start the provider and does not collect debug data.
Single-player clocks and the debug overlay (`TickFrameManager`,
`attachDebug`) live in `runtime/src/host`. The runner then drives the standard
`start()` pipeline tick by tick (see [finding 3](#3-driving-ticks-simworldstep-vs-gameworld)).

## 2. Match config and slots

`src/game/MatchConfig.ts`.

```ts
export type SimMode = 'client' | 'server';
export type BotHostSide = 'local' | 'server';

export interface HumanSlotConfig {
  readonly slot: number;
  readonly team: number;
  readonly kind: 'human';
  /** Relay player id (network) or any unique string (local). */
  readonly playerId: string;
}
export interface BotSlotConfig {
  readonly slot: number;
  readonly team: number;
  readonly kind: 'bot';
  readonly policy: string; // key into GameDefinition.bots
  readonly level: number; // integer difficulty
  /** 'server' only in simMode 'server'; 'local' only in simMode 'client'. */
  readonly runsOn: BotHostSide;
}
export type SlotConfig = HumanSlotConfig | BotSlotConfig;

export interface MatchConfigBase<Slot extends SlotConfig = SlotConfig> {
  readonly matchId: string;
  readonly gameId: string; // = GameDefinition.id
  readonly simVersion: string; // = GameDefinition.simVersion
  readonly seed: number; // u32
  readonly simMode: SimMode;
  readonly slots: readonly Slot[]; // ascending, contiguous from 0
  readonly inputDelayTicks: number; // >= 1, <= server maxTickAhead
}

export interface SlotInfo {
  readonly slot: number;
  readonly team: number;
  readonly kind: 'human' | 'bot';
  readonly playerId: string; // human playerId or `bot:<slot>`
}
export interface BotSlotInfo extends SlotInfo {
  readonly kind: 'bot';
  readonly policy: string;
  readonly level: number;
}
```

The whole config, including game extensions (e.g.
`SlotConfig & { faction }`), MUST be JSON-safe with integer numbers only: the
server sends it over the wire and `canonicalConfigBytes` hashes it into the
snapshot header.

## 3. Commands

`src/game/commands.ts`.

```ts
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface GameCommand {
  readonly type: string;
}

export interface StampedCommand<Cmd extends GameCommand = GameCommand> {
  readonly tick: number;
  readonly slot: number;
  readonly seq: number; // per-slot submission order
  readonly command: Cmd;
}

export interface CommandRejection {
  readonly rejected: true;
  readonly reason: string;
}
export function rejectCommand(reason: string): CommandRejection;
export function isCommandRejection(value: unknown): value is CommandRejection;

export interface CommandSchema<Cmd extends GameCommand, Sim> {
  readonly types: readonly Cmd['type'][];
  /** Pure, structural, no sim access: wire payload → command | rejection. */
  decode(raw: unknown, slot: SlotInfo): Cmd | CommandRejection;
  /** Pure, deterministic, state-dependent. Runs in-sim on every peer. */
  validate?(
    command: Cmd,
    slot: SlotInfo,
    sim: Readonly<Sim>
  ): CommandRejection | null;
  /** Typed command → JSON-safe payload. Default: the command itself. */
  encode?(command: Cmd): JsonValue;
}

/** `PlayerCommand.data` of every runtime command. Always defined. */
export interface CommandEnvelope {
  readonly q: number;
  readonly p: JsonValue;
}
export interface TransportCommand {
  readonly type: string;
  readonly data: CommandEnvelope;
}
```

FP values cannot cross the JSON wire as `bigint`. Send them as decimal
strings of the raw value and convert in `decode`.

## 4. GameState contract (approved)

`src/state/GameState.ts`, `src/state/StateIO.ts`. Approved by Andrey
2026-10-14; the shape is kept, details are corrected with evidence below.

```ts
export interface GameState {
  save(w: StateWriter): void;
  /** Always into a world from createWorld(config, { purpose: 'restore' }),
   *  before its first tick. */
  restore(r: StateReader): void;
}

/** Format v → v + 1. Pure bytes → bytes; the engine chains steps. */
export type StateMigration = (old: StateReader, out: StateWriter) => void;

export interface GameStateSpec<Sim = unknown> {
  readonly formatVersion: number;
  bind(sim: Sim): GameState;
  readonly migrate?: Readonly<Record<number, StateMigration>>;
}

export interface StateWriter {
  u8(v: number): void;
  u32(v: number): void;
  i32(v: number): void;
  varint(v: number): void; // unsigned LEB128, 0..2^53-1
  i64(v: bigint): void; // FP.ToRaw(fp), LE
  bool(v: boolean): void;
  str(v: string): void; // varint(byteLength) + UTF-8; unpaired surrogates throw
  bytes(v: Uint8Array): void; // varint(length) + bytes
  section(key: string, version: number, body: (w: StateWriter) => void): void;
  /** varint(count) + items in the GIVEN order (observable order). */
  list<T>(items: readonly T[], each: (item: T, w: StateWriter) => void): void;
  /** varint(count) + items ascending by integer key (unobservable order). */
  sortedBy<T>(
    items: Iterable<T>,
    key: (item: T) => number,
    each: (item: T, w: StateWriter) => void
  ): void;
}

export interface StateReader {
  u8(): number;
  u32(): number;
  i32(): number;
  varint(): number;
  i64(): bigint;
  bool(): boolean;
  str(): string;
  bytes(): Uint8Array;
  section<T>(key: string, read: (r: StateReader, version: number) => T): T;
  list<T>(read: (r: StateReader, index: number) => T): T[]; // reads list and sortedBy
}

export class BinaryStateWriter implements StateWriter {
  finish(): Uint8Array;
}
export class BinaryStateReader implements StateReader {
  constructor(bytes: Uint8Array);
  done(): void; // throws on trailing bytes
}
export class SnapshotRejectedError extends Error {
  readonly reason: string;
}
export class SnapshotRoundTripError extends Error {
  readonly section?: string;
}
```

There is deliberately **no float method** on the writer.

### Determinism requirements (normative)

1. **Canonical bytes.** Little-endian, fixed width; lengths and counts as
   varint; the byte stream is exactly the sequence of writer calls,
   independent of object history.
2. **Deterministic order.** Two cases:
   - containers whose iteration order is **observable by simulation code**
     (effect queues, pool free lists, insertion-ordered `Set`s / `Map`s that a
     system iterates) are written with `list` **in their current order** and
     restored in that order;
   - containers whose order is not observable (an id-keyed lookup) are
     written with `sortedBy` ascending by numeric id.
     Never rely on `Object.keys` / `for…in` order. (The draft said "always
     sort"; that breaks continuation, see [finding 5](#5-gas-state).)
3. **Forbidden in sim state:** fractional numbers (f32/f64), `JSON.stringify`,
   `Date`, `Math.random`. FP values go as raw `i64`.
4. **Completeness.** The sim RNG; all id counters (entities, GAS effect
   instances, pool free lists, game counters); command and event queues;
   system caches that affect future ticks (or recompute them
   deterministically in `restore`). Presentation state is excluded. **Bot
   state is excluded** (it is not shared simulation state, see
   [§ 7](#7-bots)).
5. **Round-trip.** `restore(save(A))` then `save()` produces **identical
   bytes**. The runner checks this on every restore
   (`RunnerOptions.roundTripCheck`, default on) and throws
   `SnapshotRoundTripError`.
6. **Continuation.** World A and `restore(save(A))` run 500 ticks on the same
   log and produce an equal digest every tick. Every game MUST have this
   test.
7. **Digest.** `digestBytes(body)` = xxhash64 of the `GameState` bytes. In
   server mode the server computes it itself; it is the single hash source
   (see [finding 9](#9-hashing)).
8. **Fresh-world restore.** `restore` runs only on a world created with
   `purpose: 'restore'`; it recreates dynamic entities by id and never has to
   clear an old match.

## 5. Snapshot header, layout and version policy

`src/state/snapshot.ts`, `src/constants.ts`.

```ts
export type SnapshotBytes = Uint8Array;
export type Digest = string; // lowercase hex xxhash64, 16 chars

export interface SnapshotHeader {
  readonly magic: 'PHXS';
  readonly engineFormat: number; // ENGINE_SNAPSHOT_FORMAT
  readonly gameId: string;
  readonly simVersion: string;
  readonly formatVersion: number;
  readonly configHash: Digest;
  readonly tick: number; // last completed tick
  readonly digest: Digest; // digestBytes(body)
}

export interface DecodedSnapshot {
  readonly header: SnapshotHeader;
  readonly body: Uint8Array; // GameState bytes, covered by digest
  readonly botState: Uint8Array | null; // NOT covered by digest
  readonly inputCheckpoint: Uint8Array | null; // NOT covered by digest
}

export interface SnapshotExtras {
  readonly botState?: Uint8Array | null;
  readonly inputCheckpoint?: Uint8Array | null;
}

export type VersionDecision = 'accept' | 'migrate' | 'reject';
export interface CompatibilityResult {
  readonly decision: VersionDecision;
  readonly reason?: string;
}
export interface ExpectedSnapshotIdentity {
  readonly engineFormat: number;
  readonly gameId: string;
  readonly simVersion: string;
  readonly formatVersion: number;
  readonly configHash: Digest;
}

export function encodeSnapshot(
  header: Omit<SnapshotHeader, 'magic' | 'digest'>,
  body: Uint8Array,
  extras?: SnapshotExtras
): SnapshotBytes;
export function decodeSnapshot(bytes: SnapshotBytes): DecodedSnapshot;
export function digestBytes(bytes: Uint8Array): Digest;
export function canonicalConfigBytes(config: unknown): Uint8Array;
export interface ComponentSchemaHash {
  readonly name: string;
  readonly fields: readonly (readonly [string, string])[];
}
export function configHash(
  config: unknown,
  components?: readonly ComponentSchemaHash[]
): Digest;
export function checkSnapshotCompatibility(
  header: SnapshotHeader,
  expected: ExpectedSnapshotIdentity,
  migrations?: Readonly<Record<number, unknown>>
): CompatibilityResult;

export const ENGINE_SNAPSHOT_FORMAT = 1;
export const SNAPSHOT_MAGIC = 'PHXS';
export const REPLAY_FORMAT = 1;
export const DEFAULT_SERVER_SNAPSHOT_EVERY_TICKS = 1000;
export const DEFAULT_CLIENT_SNAPSHOT_EVERY_TICKS = 300;
export const DEFAULT_HASH_EVERY_TICKS = 60;
export const DEFAULT_INPUT_DELAY_TICKS = 2;
```

### Snapshot layout

Task 2 implements this exact byte layout (all through `BinaryStateWriter`):

1. 4 bytes ASCII `PHXS`;
2. `varint engineFormat`, `str gameId`, `str simVersion`,
   `varint formatVersion`, `str configHash`, `varint tick`, `str digest`;
3. `bytes body` (the `GameState.save()` output);
4. `bool hasBotState`, then `bytes botState` if true;
5. `bool hasInputCheckpoint`, then `bytes inputCheckpoint` if true;
6. `bool hasComponentSchemas`, then `str componentSchemas` if true.
   Outside the digest. Empty when the writer registered no components.

`encodeSnapshot(header, body, extras?)` takes both extra sections in a
`SnapshotExtras` object. Neither is covered by `header.digest`. A runner
applies them only for slots it hosts or submits; a client restoring a
server snapshot ignores both. The input checkpoint is the writer's
not-yet-delivered submits (input delay) and the per-slot `nextSeq`.

`canonicalConfigBytes`: object keys sorted by UTF-16 code unit
(`Array.prototype.sort()` default), values tagged by type, safe integers
only; throws on non-integer numbers, `bigint`, `undefined`, functions and
class instances.

### Version policy

| Mismatch                                 | Action                                                   |
| ---------------------------------------- | -------------------------------------------------------- |
| `magic` / `engineFormat`                 | reject                                                   |
| `gameId` / `configHash`                  | reject                                                   |
| `simVersion`                             | reject (match ends "no result"; replay kept)             |
| `formatVersion` older, same `simVersion` | `migrate` if every step `migrate[v]` exists, else reject |
| `formatVersion` newer                    | reject                                                   |
| `digest` ≠ `digestBytes(body)`           | reject (corrupt)                                         |

A reject throws `SnapshotRejectedError(reason)`. `migrations[v]` is the step from version `v` to `v + 1`.

## 6. StateHelpers (optional)

Task 6.5a moved this object to `@phalanx-engine/runtime/advanced`. It is
not exported from the package root. Games use `defineComponent` and
`world.save` / `world.restore` instead. The section byte layout is
unchanged.

`defineComponent(name, fields, { defaults? })` registers a named SoA
schema. `world.registerComponent` order is deterministic and, when
non-empty, is folded into `configHash` together with each field's name
and type in declaration order. `f32` / `f64` fields throw (those columns
are skipped in snapshots). Any other type outside `i32`, `u32`, `u8`,
`i64`, `f32`, `f64` throws at `defineComponent` and lists the allowed
types. The name `SoASchema` is reserved, along with the world-module
section names. `registerComponent` also registers the component type, so
`queryEntities` finds entities spawned with it. A failed `world.spawn`
disposes the partial entity and removes the SoA rows already inserted.
`world.each` resolves the dense index on every access and throws if that
entity was removed. Restore calls `onComponentAdded` when a kept entity
gains a component, and `onDestroy` plus `onComponentRemoved` when one is
dropped. `world.spawn({ Name: values })`, `world.despawn(entity)` and
`world.each(component, fn)` use the existing entity id counter. The object
passed to `each` is one reused view; do not store it. Importing
`@phalanx-engine/runtime` calls `setWorldModuleHost` once. Without that
import, `save` / `restore` / `spawn` / `despawn` / `each` throw.
`world.restore` returns checked-out pooled entities and removes entities
absent from the roster before reading sections. Missing roster ids are
empty shells. Component membership comes from the SoA sections, not from
the full registry. A roster id that already exists is kept, its rows are
overwritten, then component `onEnable` runs. A snapshot whose registered
fields differ from the booted world fails before the body is applied:
`component 'Unit' schema changed: expected x:i32,hp:u32, got hp:u32,x:i32`.
The schema text rides in the snapshot envelope, outside the body digest,
so section bytes stay the same. `spawnWithId` itself
still throws when the id is registered. `bindWorldSingletons` appends
optional game sections after the `modules` container.

Component lifecycle is `onCreate` (add), `onEnable` (pool spawn, `world.spawn`,
and after restore), `onDisable` (return to pool or despawn) and `onDestroy`
(`dispose`, including pool drain). Pool return resets SoA fields to schema
defaults and GAS attributes, the granted ability set, and `initComponent`
tags to the factory shell. `addReturnToPoolHook` and
`isPoolableComponent` are internal. `IPoolableComponent` is exported.

`src/advanced/StateHelpers.ts`, re-exported from `src/advanced/index.ts`.
A plain `as const` object, not a TS `namespace`. The engine's world
modules call these; a hand-written `GameState` MAY call them too.

```ts
export const StateHelpers: {
  writeSoAStore<S>(w: StateWriter, store: SoAComponentStore<S>): void; // Task 4
  readSoAStore<S>(r: StateReader, store: SoAComponentStore<S>): void;
  writeSoAStores(
    w: StateWriter,
    world: GameWorld,
    schemas: readonly SoASchema[]
  ): void;
  readSoAStores(
    r: StateReader,
    world: GameWorld,
    schemas: readonly SoASchema[]
  ): void;
  writeEntityIds(w: StateWriter, world: GameWorld): void;
  readEntityIds(r: StateReader, world: GameWorld): void;
  spawnWithId<E extends Entity>(
    world: GameWorld,
    id: number,
    create: () => E
  ): E;
  writePools(w: StateWriter, world: GameWorld): void;
  readPools(r: StateReader, world: GameWorld): void;
  writeRandom(w: StateWriter, rng: IRandom): void;
  readRandom(r: StateReader, rng: IRandom): void;
  writeModuleSections(w: StateWriter, world: GameWorld): void;
  readModuleSections(r: StateReader, world: GameWorld): void;
};
```

**Restore order (normative).**

1. Recreate dynamic entities by id (`spawnWithId`, `readPools`); their
   constructors create the SoA rows.
2. Overwrite row values (`readSoAStores`).
3. `readEntityIds` sets the counter to the saved high-water mark.
4. `readRandom`.
5. `readModuleSections` reads the `modules` container: each registered
   section (`abilities`, `physics.broadphase`, game sections) in
   ascending key order, then game singletons. Ability and physics
   bytes are written by those packages. A custom `GameState` calls
   `writeModuleSections` / `readModuleSections` instead of copying the
   container. A grid rebuilt from transforms does not reproduce
   pre-separation centers.

`save` writes the same sections in the same order.

`writeSoAStore` writes `section(<schema name>, 1)`, `varint(rows)`, then per
entity id ascending `u32 id` and every non-float field in schema declaration
order. `f32` / `f64` fields are skipped (presentation caches such as
`PhysicsBody.lastX`). It throws if the schema has no explicit, unique name.

## 7. Bots

`src/runner/BotPolicy.ts`, `src/runner/BotHost.ts`.

```ts
export interface BotPolicy<
  Cmd extends GameCommand = GameCommand,
  Sim = unknown,
> {
  /** After tick `tick`. MUST NOT mutate sim. Executes at tick + inputDelayTicks. */
  decide(sim: Readonly<Sim>, tick: number): readonly Cmd[];
  save?(w: StateWriter): void; // private state for local resume
  restore?(r: StateReader): void;
}

/** rng: fresh DeterministicRandom seeded from (config.seed, slot.slot). */
export type BotPolicyFactory<Cfg, Cmd, Sim> = (
  config: Cfg,
  slot: BotSlotInfo,
  rng: IRandom
) => BotPolicy<Cmd, Sim>; // bivariant

export interface BotDecision<Cmd> {
  readonly slot: number;
  readonly commands: readonly Cmd[];
}
export class BotHost<G extends AnyGameDefinition> {
  constructor(definition: G, config: ConfigOf<G>, side: RunnerSide);
  get slots(): readonly number[];
  decideAll(
    sim: Readonly<SimOf<G>>,
    tick: number
  ): readonly BotDecision<CommandOf<G>>[];
  save(w: StateWriter): void;
  restore(r: StateReader): void;
}

export const BOT_PLAYER_ID_PREFIX = 'bot:';
export function botPlayerId(slot: number): string; // 'bot:<slot>'
export function isBotPlayerId(playerId: string): boolean;
```

- A bot slot is a **player**: its commands enter the same log as humans', so
  replay and reconnect never run the bot.
- Only the side that hosts the slot (`runsOn`) runs the policy.
- **Bot state is not `GameState`.** In server mode the clients never run
  server bots, so bot state in the body would make server and client digests
  differ forever. It lives in the snapshot's `botState` part, outside the
  digest. The section stores every slot's controller mode (applied on every
  peer) and then the hosting side's policy and RNG bytes (applied only when
  the side matches and this host runs the slot). A hosted bot is reused only
  when policy, level, and `runsOn` match the saved record.
- Timing: a decision after tick T executes at `T + inputDelayTicks`.

## 8. MatchRunner, CommandLog, WorldScope, replays

`src/runner/*.ts`.

```ts
export type RunnerSide = 'client' | 'server';
export interface RunnerOptions {
  readonly side?: RunnerSide; // default 'client'
  readonly localSlots?: readonly number[];
  readonly hashEveryTicks?: number; // default 60
  readonly roundTripCheck?: boolean; // default true
}
export interface FastForwardOptions {
  readonly budgetMs: number;
  /** Inclusive. Empty ticks still run. Replay: lastTick.
   *  Server catch-up: TransportCatchUp.currentTick - 1. */
  readonly throughTick: number;
  readonly onProgress?: (progress: number) => void;
}

export class MatchRunner<G extends AnyGameDefinition> {
  constructor(
    definition: G,
    config: ConfigOf<G>,
    transport: Transport,
    options?: RunnerOptions
  );
  static join<G>(
    definition: G,
    transport: Transport,
    options?: RunnerOptions
  ): Promise<MatchRunner<G>>; // Task 12
  static fromReplay<G>(
    definition: G,
    replay: ReplayRecord<ConfigOf<G>>,
    options?: RunnerOptions
  ): MatchRunner<G>;
  get sim(): SimOf<G>; // replaced by restore: never cache
  get tick(): number; // last completed, -1 before start
  get log(): CommandLog;
  start(): void;
  stop(): void;
  dispose(): void;
  submit(command: CommandOf<G>, slot?: number): void;
  snapshot(): SnapshotBytes;
  restore(bytes: SnapshotBytes): void;
  digest(): Digest;
  fastForward(
    entries: Iterable<LogEntry>,
    options: FastForwardOptions
  ): Promise<void>;
  toReplay(): ReplayRecord<ConfigOf<G>>;
  onTick(h: (tick: number) => void): Unsubscribe;
  onFrame(h: (alpha: number, dt: number) => void): Unsubscribe;
  onOutcome(h: (outcome: MatchOutcome) => void): Unsubscribe;
  onCatchUp(h: (progress: number) => void): Unsubscribe;
  onDigest(h: (tick: number, digest: Digest) => void): Unsubscribe;
  onRejected(h: (entry: LogEntry, reason: string) => void): Unsubscribe;
}

export interface LogEntry {
  readonly tick: number;
  readonly playerId: string; // human id or bot:<slot>
  readonly type: string;
  readonly data: CommandEnvelope;
}
export class CommandLog {
  get length(): number;
  get lastTick(): number;
  appendTick(tick: number, entries: readonly LogEntry[]): void;
  entriesAfter(afterTick: number): readonly LogEntry[];
  truncateThrough(tick: number): void;
}

export class WorldScope {
  run<T>(fn: () => T): T;
}

export interface ReplayRecord<Cfg extends MatchConfigBase = MatchConfigBase> {
  readonly format: number;
  readonly gameId: string;
  readonly simVersion: string;
  readonly config: Cfg;
  readonly log: readonly LogEntry[];
  readonly lastTick: number;
  readonly finalDigest?: Digest;
}
```

**Per tick T** (all inside `WorldScope.run`):

1. take the batch of T from the transport and append it to the log;
2. map `playerId` → slot through the config; drop unknown ids;
3. sort by (slot, seq); for each entry: `commands.decode` →
   `commands.validate` → `sim.applyCommand`; rejected entries stay in the log
   and are rejected again on replay;
4. emit T on the runner-owned `tickFrameProvider`, so the world's standard
   `start()` pipeline runs the tick systems;
5. `outcome(sim)`; a digest every `hashEveryTicks`;
6. hosted bots `decide(sim, T)` → submitted for `T + inputDelayTicks`.

`submit` never applies input locally before the transport delivers it in a
batch. `snapshot` is taken after step 6, so the input checkpoint holds the
commands just submitted for `T + inputDelayTicks` and `nextSeq`. `restore`
builds a fresh world with `purpose: 'restore'`, then calls
`GameState.restore`, `done()`, and the round-trip check. The bot section
stores every slot's controller mode, which every peer applies, then the
hosting side's policy and RNG bytes. A client restoring a server snapshot
keeps those modes and ignores the other side's policy bytes. The input
checkpoint is applied only for slots this runner hosts or submits.

`fastForward(entries, { budgetMs, throughTick })` runs every tick after the
current one through `throughTick` inclusive, including ticks that have no
entries, without frames, in chunks of `budgetMs`. It discards the restored
checkpoint (the log supersedes it). After each replayed tick the hosted
policies `decide`; the result is submitted only when its target tick is
past `throughTick`. `start` with no `fastForward` re-submits the checkpoint
and does not call `decide` again for the snapshot tick. `fromReplay` never
calls `decide`.

## 9. Transport

`src/transport/Transport.ts`, `src/transport/LocalTransport.ts`.
`Transport`, `TransportKind`, `TransportJoin`, `TransportCatchUp`,
`CommandEnvelope` and `TransportCommand` are exported from
`@phalanx-engine/runtime/advanced` (and `@phalanx-engine/game/advanced`).
The root keeps `LocalTransport`.

```ts
export type TransportKind = 'local' | 'relay-lockstep' | 'server-peer';

export interface TransportCatchUp {
  readonly snapshot?: SnapshotBytes; // absent → replay log from tick 0
  readonly log: readonly LogEntry[];
  /** Next server tick to run. throughTick = currentTick - 1. */
  readonly currentTick: number;
}
export interface TransportJoin {
  readonly config: unknown; // validated by the runner
  readonly localSlots: readonly number[];
  readonly catchUp?: TransportCatchUp;
}

export interface Transport extends ITickFrameProvider {
  readonly kind: TransportKind;
  submit(
    targetTick: number,
    slot: number,
    commands: readonly TransportCommand[]
  ): void;
  join?(): Promise<TransportJoin>;
  submitHash?(tick: number, digest: Digest): void;
  onDesync?(handler: (tick: number) => void): Unsubscribe;
  requestResync?(): Promise<TransportCatchUp>;
  dispose?(): void;
}

export interface LocalTransportOptions {
  readonly tickRate: number;
  readonly maxFrameTime?: number; // default 0.25 s
}
export class LocalTransport implements Transport {
  readonly kind: 'local';
  constructor(options: LocalTransportOptions);
  static manual(): LocalTransport; // clock-less for tests and replays
  step(count?: number): void;
  // + every ITickFrameProvider member, submit, dispose
}
```

**Batch contract.** `onTick(tick, batch)` delivers every command executed at
`tick`; `batch.commands[playerId]` holds `PlayerCommand`s whose `data` is a
`CommandEnvelope`. Ticks arrive strictly ascending without gaps. The runner
does not rely on key or array order.

---

## 10. Examples

### 10.1 Game state (illustrative)

```ts
// sketch-legion/src/sim/state/LegionState.ts — shape only, not runnable
export const LegionStateSpec: GameStateSpec<LegionSim> = {
  formatVersion: 1,
  bind: (sim) => new LegionState(sim),
};

class LegionState implements GameState {
  constructor(private readonly sim: LegionSim) {}

  save(w: StateWriter): void {
    const { world, rng, economy, grids, buildings, waves, domination } =
      this.sim;
    w.section('core', 1, (w) => {
      StateHelpers.writeEntityIds(w, world);
      StateHelpers.writeRandom(w, rng); // the sim RNG (= world.random)
    });
    w.section('pools', 1, (w) => StateHelpers.writePools(w, world));
    w.section('economy', 1, (w) =>
      w.sortedBy(
        economy.sides,
        (s) => s.slot,
        (s, w) => {
          w.i64(s.money);
          w.u32(s.supply);
          w.u8(s.mines);
          w.u32(s.incomeTimer);
        }
      )
    );
    w.section('domination', 1, (w) => {
      w.i32(domination.ownerSlot);
      w.u32(domination.holdTicks);
    });
    w.section('grids', 1, (w) =>
      w.sortedBy(
        grids,
        (g) => g.slot,
        (g, w) => {
          w.str(g.faction);
          w.list(g.cells, (c, w) => w.u8(c.unitType)); // by cell index
        }
      )
    );
    w.section('waves', 1, (w) => {
      w.u32(waves.nextWaveTick);
      w.u32(waves.index);
    });
    w.section('buildings', 1, (w) =>
      w.sortedBy(
        buildings,
        (b) => b.entityId,
        (b, w) => {
          w.u32(b.entityId);
          w.u8(b.kind);
          w.i64(b.hp);
          w.u32(b.attackCooldown);
        }
      )
    );
    w.section('soa', 1, (w) =>
      StateHelpers.writeSoAStores(w, world, [
        TransformSchema,
        BodySchema,
        UnitSchema,
        ShieldSchema,
        ProjectileSchema,
      ])
    );
    // Ability and physics bytes are not written here. The default world
    // handler writes them inside section('modules', 1), sorted by key.
    // NOT included: bot plans/RNGs (BotPolicy.save, outside the digest),
    // the targeting cache (recomputed on the next tick % 4), interpolation
    // and cues. The tick is in the header.
  }

  restore(r: StateReader): void {
    // Same sections, same order. Entities first (spawnWithId / readPools),
    // then values, then the id counter, then RNG. Module sections follow
    // when the handler is the world modules.
  }
}
```

Changes against the draft: no `bots` section (finding 8); no `tick` field
(the header owns it); pools are saved (finding 11); `readPhysicsAndRebuild`
is replaced by `writeSoAStores` + `readBroadphase` (finding 6); grid cells
use `list`.

### 10.2 Public usage (corrected)

```ts
// shared: sketch-legion/src/sim
export const SketchLegion = defineGame({
  id: 'sketch-legion', // = server gameTypes[].gameType
  simVersion: SIM_VERSION,
  tickRate: 10,
  createWorld: (config: LegionConfig, ctx) => new LegionSim(config, ctx),
  commands: LegionCommands, // CommandSchema: { types, decode, validate, encode }
  state: { formatVersion: 1, bind: (sim) => new LegionState(sim) },
  bots: { standard: (config, slot, rng) => new LegionBot(slot.level, rng) },
  outcome: (sim) => sim.buildings.baseDestroyed() ?? sim.timeoutWinner(),
});

// client: offline vs a local bot
import {
  MatchRunner,
  LocalTransport,
  ServerPeerTransport,
} from '@phalanx-engine/client';
const offline = new MatchRunner(
  SketchLegion,
  {
    matchId: 'local-1',
    gameId: 'sketch-legion',
    simVersion: SIM_VERSION,
    seed,
    simMode: 'client',
    inputDelayTicks: 2,
    slots: [
      {
        slot: 0,
        team: 0,
        kind: 'human',
        playerId: 'local:0',
        faction: 'guard',
      },
      {
        slot: 1,
        team: 1,
        kind: 'bot',
        policy: 'standard',
        level: 2,
        runsOn: 'local',
        faction: 'swarm',
      },
    ],
  },
  new LocalTransport({ tickRate: 10 })
); // persistence: Task 7 MatchStore

// client: online, server mode (config comes from the server)
const online = await MatchRunner.join(
  SketchLegion,
  new ServerPeerTransport({ url, auth })
);

// server
import { Phalanx } from '@phalanx-engine/server';
const server = new Phalanx({
  gameTypes: [{ gameType: 'sketch-legion', tickRate: 10 /* ... */ }],
  sim: createServerSim({
    games: [{ module: './myGame.js' }],
    snapshotEveryTicks: 1000,
  }),
  // reconnect window/budget: Task 10 config fields
});
// Rooms with a server bot: a new room path in Task 11 (private rooms are
// hard-coded to 2 humans today).
```

---

## Review & corrections

Each finding: evidence (file:line on `main` `a956a67`), decision, and where
the correction lands.

### 1. RNG location

- **Evidence.** Two identical `DeterministicRandom` copies exist:
  `phalanx-client/src/DeterministicRandom.ts:15` (pure-rand
  `xoroshiro128plus`, `:24`) and `phalanx-server/src/utils/DeterministicRandom.ts`.
  The server copy adds `generateSeed()`, which calls `require('crypto')`
  (`:142`) in an ESM package: broken, and unused, because
  `GameRoom.ts:144` uses `randomBytes`. `GameWorldConfig.random` already
  exists (`phalanx-ecs/src/GameWorld.ts:74`) and falls back to
  `tickFrameProvider.random` (`:67`, `:193`).
- **Decision.** Move `DeterministicRandom` into **`@phalanx-engine/math`**
  (Task 3) and add `getState(): readonly number[]`,
  `setState(state)` and `static fromState(state)`. pure-rand 7
  `xoroshiro128plus` exposes `getState()` (4 × int32) and
  `xoroshiro128plus.fromState(state)`, which continues the sequence
  identically (verified). Client and server re-export it under the same
  name, so nothing breaks.
- **Why math, not runtime.** The runtime is `private` until Task 13, so the
  published client/server cannot depend on it earlier; math is already a
  dependency of both, and ecs' `IRandom` is the interface.
- **How the world gets it.** The runner creates the match RNG from
  `config.seed` and passes it as `WorldInitContext.random`; the game passes
  it to `new GameWorld({ random: ctx.random, ... })`.
- **Floats.** `IRandom.float`, `floatRange` and `boolean` are `@deprecated`
  as of this PR (ecs interface and both `DeterministicRandom` copies).
  Simulation code uses `int` / `intRange`. The methods stay as wrappers
  until the remaining call site (`abilities-playground`
  `ArtilleryShellSystem`) is moved off them; Task 13 removes the methods
  once that call site is gone. New sim code must not add any.

### 2. Transport vs `ITickFrameProvider`

- **Evidence.** `CommandsBatch {tick, commands: {[playerId]: PlayerCommand[]}}`
  (`phalanx-ecs/src/ITickFrameProvider.ts`). The server sorts each tick by
  `playerId.localeCompare`, then `type.localeCompare`
  (`phalanx-server/src/services/GameRoom.ts:651–654`, again `:812–814`).
  That loses a player's submission order, and `localeCompare` differs from
  the code-unit order of AGENTS.md §6 `Object.keys().sort()`. The relay drops
  commands whose `data === undefined` (`Phalanx.ts:590`). The wire is JSON
  over socket.io, so `bigint` cannot travel. The client flushes commands for
  `currentTick` with no input delay (`PhalanxClient.ts:1040`); the server
  files late commands under `max(tick, currentTick)` (`GameRoom.ts:699`).
- **Decision.** `Transport extends ITickFrameProvider` and adds
  `submit(targetTick, slot, TransportCommand[])` plus optional network methods.
  `PhalanxClient` satisfies the provider part structurally. The runner is
  the world's `tickFrameProvider`; the transport is the runner's upstream.
  - `playerId` ↔ slot comes from the config: human slot `playerId`, or
    `bot:<slot>`. Unknown ids are dropped.
  - Canonical order is **(slot, seq)**, computed by the runner. It never
    depends on the server's `localeCompare` sort or on key order.
  - `data` is always a `CommandEnvelope {q, p}`; `p` is JSON-safe.
  - The runner submits for `lastTick + inputDelayTicks`; the delivered batch
    is the only truth.

### 3. Driving ticks (`SimWorld.step` vs `GameWorld`)

- **Evidence.** `GameWorld.start()` subscribes to `provider.onTick` and runs
  beforeTick systems → `hooks.beforeTick` → `processAllTicks` → afterTick
  systems → `hooks.afterTick` (`GameWorld.ts:409–414`). AGENTS.md §4.2 forbids
  calling `processAllTicks` outside tests.
- **Decision.** No new ecs entry point. The runner owns a provider, passes it
  as `WorldInitContext.tickFrameProvider`, and emits each tick on it after
  applying commands. `SimWorld.step(tick, commands)` and `SimWorld.hash()`
  from the draft are replaced by `applyCommand(stamped)` plus a
  runner-computed digest of `save()`. `fastForward` emits ticks without
  frames.
- **Pause hazard.** If the provider lacks `requestPause`, `GameWorld.pause()`
  sets `_paused` directly (`GameWorld.ts:229–241`), and every later tick is
  silently skipped (`:410`), which desyncs the world. The runner's provider
  MUST implement `requestPause` / `requestResume` / `onPause` / `onResume`
  and forward them to the transport (Task 6).

### 4. Entity id counter and SoA context (critical)

- **Evidence.** `let entityIdCounter = 0` is module-global
  (`phalanx-ecs/src/Entity.ts:3`), consumed in the `Entity` constructor
  (`:41`). `GameWorld`'s constructor calls `resetEntityIdCounter()`
  (`GameWorld.ts:156`) and `SoAComponent.useEntityManager(...)` (`:162`),
  which sets the static `SoAComponent._entityManager`
  (`SoAComponent.ts:51`, `:57`).
- **Consequence.** In one server process, creating match B resets the
  counter and steals the SoA context of match A. A's next entity gets a
  duplicate id, and its SoA rows land in B's stores. The server is the hash
  arbiter, so honest clients would be flagged as desynced. Server mode is
  **not correct** without isolation. The same applies to two worlds in one
  test.
- **Decision.** A documented, enforced workaround instead of a per-world
  counter:
  - Task 3 adds `getEntityIdCounter()` / `setEntityIdCounter(n)` and
    `SoAComponent.currentEntityManager()` to ecs (additive).
  - The runtime `WorldScope.run(fn)` saves the globals, installs the world's
    counter and EntityManager, runs `fn` synchronously, stores the counter
    back and restores the previous globals. The runner wraps **every** entry
    into a world: `createWorld`, each tick, `snapshot`, `restore`, bot
    decisions.
  - Rejected alternative: a per-world counter, which requires `new Entity()`
    to find its world. That changes the `Entity` constructor contract and
    breaks existing games.
- `globalEventBus` (`EventBus.ts:145`) is also global, but the engine does
  not use it. Games MUST NOT use it in server-mode sims.

### 5. GAS state

- **Evidence.** Per-entity components:
  - `AttributesComponent`: `base`, `current` and `dirty: Uint8Array`
    (`phalanx-abilities/src/components/AttributesComponent.ts:8`, `:19`). `dirty`
    is sim-relevant (it drives aggregation).
  - `ActiveEffectsComponent`: `queue` of `ActiveEffectInstance`
    (`instanceId`, `defId`, `remainingTicks`, `nextPeriodTick`,
    `sourceEntityId`, `enteredOnTick`, `capturedMagnitudes`, which may be
    `null`/`undefined`) and `pendingAdd` (`defId`, `sourceEntityId`,
    `setByCaller?: ReadonlyMap<string, unknown> | null`,
    `ActiveEffectsComponent.ts:9`, `:15`).
  - `GameplayTagsComponent`: `tags`, `adHocTags` (Sets) and
    `effectGrantCounts` (Map) (`GameplayTagsComponent.ts:39`, `:47`).
  - `AbilitySystemComponent.abilities` (a Set).
- **Draft errors.** There is no `stacks` field; `setByCaller` exists only on
  pending entries; there is no cooldown component (cooldowns are effects and
  tags).
- **Lazy components.** `ActiveEffectsComponent` and others are created on
  first use (`AbilityActivationSystem.ts:434–443`), so the helper must encode
  which GAS components each entity has and recreate them on restore.
- **Blocker.** The per-world runtime is private inside `AbilitySystemImpl`
  (`createAbilitySystem.ts:107`, `:162`). It holds the
  `InstanceIdCounter` (getter only, no setter: `InstanceIdCounter.ts`),
  pending activation requests (`providedTarget {entityId?, x?, z?}` in FP,
  `enqueueTick`), `currentTick`, `resolvedActivationsThisTick` (must be empty
  between ticks) and the cue buffer (presentation, excluded). Task 5 needs an
  additive `exportRuntimeState()` / `importRuntimeState()` (or equivalent)
  on the ability system.
- **Order.** `EffectTickSystem` iterates `queue` in array order, so the order
  is observable. Rule: preserve array and insertion order (`list`), do not
  sort. This is why `StateWriter.list` was added.
- **`setByCaller` values** are `unknown`. The helper accepts only FP
  (`bigint` raw via a tag), integers and strings and throws on anything
  else.
- Registries are per world; indices follow registration order. Both sides
  register identical definitions (`createWorld` does it), so indices may be
  written as integers.

### 6. Physics

- **Evidence.** Each substep integrates velocity, rebuilds the grid, then
  resolves collisions (`PhysicsSystem.ts:77–81`). Resolution then moves the
  transforms (`:428–446`). `queryRadius` filters with the centers cached at
  `insert` (`SpatialHashGrid.ts:42–44`, `:151–152`), so after a collision
  the grid is the pre-separation positions while the transforms are the
  post-separation ones. `CollisionSystem.processTick` (`:52–54`) has the
  same order. `lastX`/`lastZ` are the f64 copies written at insert time
  (`PhysicsSystem.ts:277–279`); they are lossy and are not a restore source.
  There is no contact carried across ticks. The next physics step rebuilds
  again, so the physics step itself does not need the old grid. Anything
  that queries before that next rebuild does.
- **Decision.** Do not change the live refresh boundary: rebuilding again
  after resolution would change query results for existing games. Task 3
  exposes the cached fixed-point centers (both grids). Task 4's
  `writeBroadphase` / `readBroadphase` persist and re-insert them.
  `rebuildBroadphaseFromTransforms` (formerly `rebuildPhysics`) rebuilds from the current transforms and is correct only
  before the first resolving step. `phalanx-physics/tests/impulseCollision.test.ts`
  locks the live behaviour: after one step, `queryRadius` at the
  post-separation transform does not contain the body. Task 4 adds the
  continuation test (collide, snapshot, restore, query again, same ids, and
  not the ids a transform rebuild would return).
- **Minor.** `PhysicsSystem.step` calls `FP.FromFloat(subSteps)` once per
  step (`:76`). Deterministic, but against AGENTS.md §2; not fixed here.

### 7. Server entry API

- **Evidence.** The entry is `new Phalanx(config?: Partial<PhalanxConfig>)`
  (`phalanx-server/src/Phalanx.ts:61`). There is no `createPhalanxServer` and
  no `server.rooms.createPrivate`. Private rooms are hard-coded to two
  humans, host = team 0 and guest = team 1
  (`phalanx-server/src/services/PrivateRoomService.ts:293`). The tick rate
  comes from `gameTypes[]` (`GameTypeConfig {gameType, tickRate, tickMode,
…}`) via `resolveGameTypeConfig`. Defaults
  (`phalanx-server/src/config/defaults.ts`): `tickRate: 20` (`:27`),
  `maxTickBehind: 10`, `maxTickAhead: 5` (`:45–46`),
  `commandHistoryTicks: 200` (`:49`), `enableStateHashing: false`,
  `stateHashInterval: 60` (`:53–54`).
- **Decision.** Docs corrected to `new Phalanx({...})`. Additive fields
  `sim?: ServerSimHook`, built with `createServerSim({ games, snapshotEveryTicks?, maxMatches? })`
  (see [server-sim.md § 6](./server-sim.md#6-server-configuration-additive)).
  `GameDefinition.id` = `gameType`; startup validates `tickRate` equality and
  continuous `tickMode`. Human-vs-server-bot rooms need a new room path
  (Task 11). `workers` is reserved until the `worker_threads` task.

### 8. Bot timing

- **Evidence.** `GameRoom.processTick` (`GameRoom.ts:634`) takes
  `pendingCommands.get(currentTick)` (`:644`), broadcasts and deletes it
  (`:667`). Incoming commands are window-checked against
  `maxTickBehind` / `maxTickAhead` and filed under `max(tick, currentTick)`
  (`:699–703`).
- **Decision.** SimHost runs tick T synchronously right after the broadcast
  in `processTick`. Bot decisions after T are written directly into
  `pendingCommands[T + d]` (key `bot:<slot>`), bypassing `handleCommand`.
  This requires `d = inputDelayTicks ≥ 1` (otherwise T + d = T is already
  broadcast) and `d ≤ maxTickAhead`. Human commands have an effective delay
  of `max(d, latency)`. Validation of bot commands happens in-sim like every
  command.
- **Bot state is not `GameState`.** Clients do not run server bots, so the
  draft `LegionState` `bots` section would make server and client digests
  differ every tick. Bot state goes into the snapshot's `botState` part,
  outside the digest (`DecodedSnapshot.botState`).

### 9. Hashing

- **Evidence.** `StateHasher` (`phalanx-client/src/StateHasher.ts`) is FNV-1a
  on an unmasked `bigint`: every byte multiplies `this.hash` by the prime
  (`:39–44`), and it is masked to 32 bits only in `finalize` (`:121`). The
  intermediate value grows without bound (quadratic cost), the output is
  32-bit, and it has no `bigint`/i64 input. `GameRoom.receiveStateHash`
  (`GameRoom.ts:1383`) compares all connected players and ends the match on
  mismatch.
- **Decision.** One source of truth: the runtime digest,
  `digestBytes(GameState.save())` (xxhash64), every `hashEveryTicks`.
  `StateHasher` stays for existing games. Task 11 compares each client
  against the server's digest and resyncs the mismatching client instead of
  ending the match. Task 5's GAS continuation test uses the runtime digest.

### 10. AGENTS.md conflicts

- **§0 "The server never simulates the world"** — amended in this PR: the
  default (relay) mode is unchanged; `simMode: 'server'` adds the server as
  a lockstep peer under the same rules.
- **§4.6 "internal simulation decisions (AI…) should use direct system
  calls"** — amended in this PR: a bot slot is a player whose `BotPolicy`
  emits ordinary commands; unit-level AI stays in systems.
- **§6 "Server never trusts client-supplied identity"** — **violated today**:
  `playerId` is taken from the request body in `queue-join`
  (`Phalanx.ts:441`), `room-create` (`:458`), `room-join` (`:468`),
  `room-recover` (`:525`) and `reconnect-match` (`:685`), even when the
  socket is authenticated. Task 9 closes `match-resume` (always, the
  id comes from the token) and, when `reconnect.requireSessionToken`
  is set, `reconnect-match` and in-match `room-recover`. `queue-join`,
  `room-create`, `room-join`, and waiting-room `room-recover` stay on
  the body id until Task 9b.
- **Other discrepancies** (reported, not changed):
  - AGENTS.md §1 says `NodeNext`; every package tsconfig uses
    `moduleResolution: bundler`. The runtime copies the ecs tsconfig.
  - AGENTS.md §1 requires `noUncheckedIndexedAccess` / `noImplicitReturns`;
    the existing package tsconfigs do not set them. The runtime does.
  - ecs relative imports lack the `.js` extension (e.g.
    `GameWorld.ts:15`).
  - `PlayerCommand.data?: any` in ecs.
  - The server uses `console.log`.
  - `pnpm lint` and `pnpm format:check` already fail on `main`; CI runs only
    build and test.

### 11. Other items that would break later tasks

- **Pools are sim state.** `EntityPool.available` is a LIFO free list
  (`phalanx-ecs/src/pool/EntityPool.ts:14`, `acquire` at `:32–38`); it
  decides which id the next spawn reuses, and prewarm consumes ids. Task 3
  adds pool accessors; Task 4 adds `writePools` / `readPools`.
- **Schema names.** `SoASchema` has no `name` (only `type.description`), and
  `defineSoASchema`'s name is optional. Task 4 must require explicit unique
  names.
- **Restore target.** Restoring into a live world would have to delete
  entities and reset pools. Restore always targets a fresh world created
  with `purpose: 'restore'`.
- **Peer ranges.** abilities and physics declare `peerDependencies`
  `"@phalanx-engine/ecs": "^0.2.0"` (`phalanx-abilities/package.json:22`,
  `phalanx-physics/package.json:22`); `^0.2.0` does not accept 0.3.0.

## Corrections for later tasks

Literal instructions for each task; they override the original task text.

- **Task 2 (StateWriter/Reader, header, digest).**
  - Implement `list` (order-preserving) in addition to `sortedBy`;
    `StateReader.list` reads both.
  - Use the [snapshot layout](#snapshot-layout) exactly, including the
    `botState` part outside the digest.
  - `canonicalConfigBytes`: sorted keys (UTF-16 code unit), safe integers
    only; throw on floats, `bigint`, `undefined`.
  - xxhash64 in pure TypeScript, seed 0, lowercase hex, 16 characters.
  - `section` is length-prefixed; `read` must consume the body exactly.
- **Task 3 (engine fixes, additive only).**
  - ecs: `getEntityIdCounter()` / `setEntityIdCounter(n)`,
    `SoAComponent.currentEntityManager()`, pool state accessors (owned ids,
    free-list order).
  - math: move `DeterministicRandom` with `getState` / `setState` /
    `fromState`; client and server re-export it; delete the broken
    `generateSeed` `require` path or reimplement it with an ESM import.
  - abilities: `InstanceIdCounter` setter and a runtime state
    export/import on the ability system.
  - physics: expose the cached fixed-point broadphase centers of
    `PhysicsSystem` and `CollisionSystem`. Do not rebuild the grid after
    resolution; that changes live query results.
  - `IRandom.float`, `floatRange` and `boolean` are already `@deprecated`.
    Keep them as wrappers when moving the class. Do not add float call
    sites. Removal is Task 13, after `ArtilleryShellSystem` stops using
    `floatRange`.
- **Task 4 (SoA/entity/RNG/physics helpers).** Require explicit unique
  schema names; implement `spawnWithId` and `writePools` / `readPools`; skip
  f32/f64 fields; follow the normative restore order. `readBroadphase`
  restores the pre-separation centers; `rebuildBroadphaseFromTransforms` is only for a world
  that has not resolved a collision yet. Continuation test: two overlapping
  bodies, one `step`, snapshot, restore, `queryRadius` matches the live
  grid and differs from a rebuild off the saved transforms.
- **Task 5 (GAS helpers).** Cover the full component layout, attributes
  including `dirty`, the effect queue and `pendingAdd` in array order, tags
  / ad-hoc tags / grant counts and abilities in insertion order, and the
  per-world runtime (instance id counter, activation requests, current
  tick). No `stacks`, no cooldown component. Test with the runtime digest,
  not `StateHasher`.
- **Task 6 (MatchRunner, LocalTransport in-memory, bot host).**
  - Drive ticks through the runner-owned provider and `world.start()`; do
    not call `processAllTicks`.
  - The provider implements pause/resume (finding 3).
  - Wrap every world entry in `WorldScope.run`; test two runners
    interleaved in one process.
  - Order by (slot, seq); keep rejected entries in the log.
  - Bot RNG seeded from `(config.seed, slot)`; bot state outside the digest.
  - Snapshot after `decide`, and write the input checkpoint (pending
    target ticks + per-slot `nextSeq`) outside the digest. Test: input
    delay 2, snapshot just after a decision, resume with an empty tail, the
    delayed commands still execute.
  - `fastForward` takes an inclusive `throughTick` and runs empty ticks.
    A log tail discards the checkpoint and still calls `decide` after each
    replayed tick, submitting only commands whose target is past
    `throughTick`. Test: snapshot at T, tail through T+50, the next live
    decision matches a run that never restored. `fromReplay` does not
    call `decide`. A client applies controller modes from a server snapshot
    and does not apply that snapshot's policy bytes or checkpoint.
- **Task 7 (persistence).** `MatchStore`, `MemoryMatchStore` and
  `IndexedDbMatchStore` live in `@phalanx-engine/runtime`. The package has
  no DOM lib; the IndexedDB store reads `globalThis.indexedDB` when a
  method runs. `LocalTransport` takes an optional `store`,
  `snapshotEveryTicks` (default 300) and `pauseWhenHidden` (default true).
  No store means no persistence. On a snapshot tick the runner seals the
  world body plus that tick's bot section and input checkpoint, and hands
  the body buffer through without a second copy. A tick that is both a hash
  tick and a snapshot tick saves the world once and passes that buffer to
  the digest and the journal. `encodeSnapshot` (and therefore its digest)
  and the store write run off the tick: `setImmediate` in Node,
  `requestIdleCallback` in browsers, otherwise `MessageChannel` or
  `setTimeout(0)`. Writes batch every 5s and on `visibilitychange: hidden`
  / `pagehide`. A failed snapshot encode or snapshot write is reported via
  `MatchRunner.onPersistenceError` and does not roll back the header or the
  command tail. `MatchRunner.resumeLocal(definition, store, matchId, options?)`
  restores the newest snapshot, including `systemSeq` and every slot's
  controller mode, then fast-forwards the command tail through the stored
  cursor so empty ticks are not dropped. A fresh match clears a reused id
  once before the first header write; resume and a retried header write do
  not. `restore` recomputes the terminal phase and, while persistence is
  on, rejects a snapshot older than the journal cursor. A tick is journaled
  before outcome, digest, and tick listeners. Hiding the page pauses only a
  started transport. A corrupt IndexedDB row rejects instead of leaving the
  write queue pending. `options` carries `snapshotEveryTicks`,
  `pauseWhenHidden`, and `RunnerOptions`. Only the last two snapshots are
  kept. Command dedup sorts payload object keys.
- **Task 7.1 (storage hardening).** IndexedDB schema v2 splits a match
  into `meta` (keyed by `matchId`), `commands` (keyed by `[matchId, seq]`,
  one chunk per `appendCommands`), and `snapshots` (keyed by
  `[matchId, tick]`). An append writes one chunk plus `meta`, not the
  whole log. Version 1's `matches` store is deleted on upgrade;
  pre-0.3.0 data is dropped and later versions must migrate.
  `LoadedMatch.previous` is the older snapshot and the commands after it.
  `resumeLocal` tries snapshots newest first, each on a new runner. A
  fast-forward error does not fall back. Every snapshot failing throws
  `MatchResumeError` and does not clear the store. On a successful
  fallback the runner's `resumeReport` names the snapshot used, and
  `deleteSnapshot?` removes the rejected ticks. It refuses to delete the
  only remaining snapshot once a command at or before a snapshot has been
  dropped. `onSnapshotFallback`
  runs only when at least one snapshot was skipped.
- **Task 8 (relay full log).** Store raw `PlayerCommand`s including the
  envelope; `match-log` chunks of ≤ 2000 ticks; `buildId`; SIGTERM.
- **Task 9 (session token).** Opt-in `session`. The token is issued
  at `match-found`, bound to that `matchId` and `playerId`, and a
  pre-start ending tombstones the id. The client store overwrites
  the token when the next match sends `session-token`.
  `match-resume` takes
  `playerId` from the HMAC token only. The token is signed, not
  encrypted; do not log it or `session.secret`.
  `reconnect.requireSessionToken` (default false) rejects legacy
  `reconnect-match` and `room-recover` after `waiting-for-players`
  (`room-error.reason` is `'session-token-required'`, and `message`
  stays the same). Recover during `waiting-for-players` stays open
  so a player who missed `match-found` receives the token. The
  flag throws at startup without `session.secret`. Waiting-room
  `room-recover` and the pre-match handlers (`queue-join`,
  `room-create`, `room-join`) are unchanged here; those three are
  Task 9b, not "all five handlers". `slot` is the index in
  `teams.flat()` (team 0 first, queue order within a team), the same
  index Task 12 will use. `absentDeadline` is the soonest other row
  from `GameRoom.getAbsences()`. A resume drops the previous socket
  from the room and is told with `session-superseded`. A re-issued
  token extends `exp` (`issue time + ttlMs`). `autoReconnect` tries
  the stored token first, and skips `reconnectToMatch` after a
  timeout when the client knows `requireSessionToken` is on.
- **Task 10 (absence timer).** Public `GameRoom.endMatch`; 120 s window,
  180 s budget; `abandoned` when all humans are absent.
- **Task 11 (SimHost).**
  - Per-room `tickRate` from `GameTypeConfig`, validated against the game.
  - Practice/training: start a server-mode match immediately, human plus
    server bots. Matchmaking auto-fill: if no live opponent arrives within
    a timeout, fill the empty slots with server bots and start (Lands /
    Chapaev). Private rooms stay 2 humans. The timeout is game config.
  - Run the sim synchronously inside `processTick`; inject bot commands into
    `pendingCommands[T + d]`, requiring `1 ≤ d ≤ maxTickAhead`.
  - Hash arbiter for **server mode only**: compare each client with the
    server and resync that client. Relay mode keeps
    `receiveStateHash` ending the match.
  - No Redis and no snapshot recovery across a process restart. In-memory
    matches end with "no result".
  - Decode-only pre-filter on the server for human commands.
- **Task 12 (ServerPeerTransport).** `MatchRunner.join` lives in the runtime
  and uses `Transport.join()`; the session token is the transport's
  concern. Client re-exports `MatchRunner`, `LocalTransport`, `defineGame`.
  Catch-up calls `fastForward` with `throughTick = currentTick - 1` and
  does not apply the snapshot's bot state or input checkpoint.
- **Task 13 (release prep).** Change the abilities/physics peer ranges to
  `workspace:^`; remove `private`; add `phalanx-runtime` to `PACKAGE_DIRS`;
  bump everything to 0.3.0 together; turn `CHANGELOG.unreleased.md` into
  `CHANGELOG.md`. Remove `IRandom.float`, `floatRange` and `boolean` once
  `ArtilleryShellSystem` no longer calls them.

## Task map

| Task | Scope                                                                 | Skeletons it implements                                                                                                                |
| ---- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Package, contracts, skeleton, design review                           | `defineGame`, constants, `botPlayerId`, `rejectCommand`                                                                                |
| 2    | StateWriter/Reader, header, digest                                    | `BinaryStateWriter/Reader`, `encode/decodeSnapshot`, `digestBytes`, `canonicalConfigBytes`, `configHash`, `checkSnapshotCompatibility` |
| 3    | Engine fixes (id counters, RNG state, broadphase, GAS runtime, pools) | — (ecs/math/abilities/physics, additive)                                                                                               |
| 4    | SoA/entity/RNG/physics helpers                                        | `StateHelpers` except abilities                                                                                                        |
| 5    | GAS helpers                                                           | `StateHelpers.writeAbilities/readAbilities`                                                                                            |
| 6    | MatchRunner, in-memory LocalTransport, bot host                       | `MatchRunner` (not `join`), `CommandLog`, `WorldScope`, `BotHost`, `LocalTransport`                                                    |
| 7    | Persistence                                                           | `MatchStore`, `MemoryMatchStore`, `IndexedDbMatchStore` (runtime)                                                                      |
| 8    | Relay full log, log-from-tick, buildId, SIGTERM                       | — (server)                                                                                                                             |
| 9    | Session token + match-resume                                          | — (server/client)                                                                                                                      |
| 10   | Absence timer + `endMatch`                                            | — (server)                                                                                                                             |
| 11   | SimHost                                                               | — (server)                                                                                                                             |
| 12   | ServerPeerTransport + client re-exports                               | `MatchRunner.join`                                                                                                                     |
| 13   | Synchronized 0.3.0 release prep + CHANGELOG                           | —                                                                                                                                      |

## Decisions (Andrey, 2026-10-14)

1. **Server restarts.** In-memory matches ending with "no result" is
   acceptable. No Redis in 0.3 (no players yet). Task 8 still sends
   `server-shutdown` on SIGTERM; Task 11 does not add persistence.
2. **No floats in `IRandom`.** `float`, `floatRange` and `boolean` are
   deprecated now. Sim code uses `int` / `intRange`. The methods are
   removed in Task 13 after the playground call site is gone.
3. **Desync.** Relay mode ends the match. Server mode resyncs the client
   and continues. Task 11 must not change the relay path.
4. **Sketch Legion bots.** A practice/training entry starts a server-mode
   match immediately (human + server bots). Matchmaking fills empty slots
   with server bots when no live opponent arrives within a timeout, as
   Lands and Chapaev do. Private rooms stay two humans. Task 11.
5. **Branch name.** This work is on `cursor/runtime-01-contracts-37b3`
   because the agent environment requires that prefix. The requested name
   was `feat/runtime-01-contracts`.
