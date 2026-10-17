import type { Json } from '../util/json.js';
import type { Capabilities } from './capabilities.js';

export type PeerId = string;

export interface SlotSpec {
  readonly kind: 'human' | 'bot';
  readonly team: number;
  readonly policy?: string;
  readonly level?: number;
}

/** Options that change the skirmish world. Plain data, no engine types. */
export interface GameOptions {
  readonly armySize?: number;
  readonly tickLimit?: number;
  readonly injectDesync?: {
    readonly peer: PeerId;
    readonly afterTick: number;
    readonly when?: 'restore' | 'tick';
  };
  readonly spawnOnRestore?: boolean;
  readonly throwOnTick?: number;
  /**
   * Test probe. A tick exception was requested, but the sim must not
   * throw it. `failsWith` has to reject that run.
   */
  readonly suppressThrow?: boolean;
  readonly throwBot?: boolean;
  readonly poolProbe?: boolean;
  /**
   * Mutation probe. After `restore`, flip a live SoA field and one RNG
   * word. Models a save/load involution whose trailing `save` leaves
   * memory dirty while snapshot bytes still match.
   */
  readonly dirtyAfterRestore?: boolean;
  /**
   * Mutation probe. `Policy.restore` consumes the saved bot words and
   * then drops them. The live dump must notice.
   */
  readonly breakBotRestore?: boolean;
  /**
   * FaultGate delivers every envelope immediately. The fault-effect
   * scenario must go red when this is set.
   */
  readonly disableFaultGate?: boolean;
}

export interface MatchSpec {
  readonly seed: number;
  readonly slots: readonly SlotSpec[];
  readonly inputDelayTicks: number;
  readonly options: GameOptions;
}

export interface PeerOptions {
  readonly role: 'authority' | 'replica' | 'replay';
}

export interface GameCommandJson {
  readonly type: string;
  readonly dir?: number;
  readonly target?: number;
  readonly ability?: number;
  readonly kind?: number;
}

/** Plain command-log row. JSON-safe. Bigints never appear here. */
export interface LogEntry {
  readonly tick: number;
  readonly playerId: string;
  readonly type: string;
  readonly data: { readonly q: number; readonly p: Json };
  readonly malformed?: true;
}

export interface ReplayFile {
  readonly format: number;
  readonly gameId: string;
  readonly simVersion: string;
  readonly config: Json;
  readonly log: readonly LogEntry[];
  readonly lastTick: number;
  readonly finalDigest?: string;
}

/**
 * Canonical dump. Ids and keys are sorted. Bigints are decimal strings.
 * The oracle diffs two dumps without knowing the game.
 */
export interface StateDump {
  readonly entities: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>
  >;
  readonly rng: readonly string[];
  readonly gas: Readonly<Record<string, string>>;
  /** Bot policy memory and bot RNG, keyed by slot. Outside snapshot bytes. */
  readonly bots: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Cumulative narrowphase contacts, decimal. */
  readonly contacts: string;
}

export interface Peer {
  readonly id: PeerId;
  submit(cmd: GameCommandJson, slot: number): void;
  /** Advance the virtual clock. Never reads wall time. */
  step(ticks: number): void;
  tick(): number;
  snapshot(): Uint8Array;
  restore(bytes: Uint8Array): void;
  fastForward(entries: readonly LogEntry[], throughTick: number): Promise<void>;
  /**
   * Submit one logged envelope to this peer's transport. Duplicates of
   * the same `(tick, playerId, seq)` are ignored. Bot envelopes are ignored.
   */
  deliver(entry: LogEntry): void;
  /** Live canonical digest. Not the snapshot-byte hash. */
  digest(): string;
  stateDump(): StateDump;
  status(): 'ready' | 'running' | 'ended' | 'failed' | 'disposed';
  /** `'win:<team>'` or `'draw:<reason>'` after the match ends. */
  outcome(): string | null;
  pause(): void;
  resume(): void;
  /** Queue one malformed envelope for the next tick. */
  injectMalformed(slot: number): void;
  toReplay(): ReplayFile;
  dispose(): void;
}

export interface MatchHandle {
  createPeer(id: PeerId, opts: PeerOptions): Peer;
  /** Authoritative command log of the match (the authority peer). */
  log(): readonly LogEntry[];
  /**
   * Fire a tick-inject on the next sim tick `tick`. No-op when the
   * scenario did not ask for one. Timeline clocks and sim ticks differ
   * while the match is paused, so the interpreter arms the tick it is
   * about to run.
   */
  armInject(tick: number): void;
  dispose(): void;
}

/**
 * The only engine-shaped contract the suite sees. A 6.5 port adds
 * `adapters/v65.ts` implementing this same interface.
 */
export interface SimDriver {
  readonly name: string;
  readonly capabilities: Capabilities;
  createMatch(spec: MatchSpec): MatchHandle;
  /** Replay runner. `step` / `start` must not be used; only `fastForward`. */
  openReplay(replay: ReplayFile): Peer;
  /** Snapshot whose game format version is newer than the running game. */
  incompatibleSnapshot(bytes: Uint8Array): Uint8Array;
  /** Schema key with two fields of one component swapped. */
  swapSchemaFields(bytes: Uint8Array): Uint8Array;
  /** Schema key with one field's type changed. */
  changeSchemaFieldType(bytes: Uint8Array): Uint8Array;
}
