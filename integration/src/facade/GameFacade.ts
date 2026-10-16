/**
 * The minimum the skirmish rules need. Implementations live in
 * `facade/current.ts` (today) and, after Task 6.5b, `facade/v65.ts`.
 * Rules never import the engine.
 */
export interface GameFacade {
  /** Perf worlds skip aura and nested scans. */
  dense(): boolean;
  drawRng(): void;
  eachUnit(fn: (id: number) => void): void;
  kindOf(id: number): number;
  teamOf(id: number): number;
  slotOf(id: number): number;
  hp(id: number): bigint;
  hasTag(id: number, tag: string): boolean;
  near(a: number, b: number, rangeRaw: bigint): boolean;
  bodiesTouching(a: number, b: number): boolean;
  applyEffect(target: number, effectId: string, source: number): void;
  kill(id: number, respawn: boolean): void;
  flushRespawns(tick: number): void;
  livingTeams(): number;
  pendingRespawns(): number;
}

export interface UnitView {
  readonly id: number;
  readonly kind: number;
  readonly slot: number;
  readonly team: number;
  readonly x: bigint;
  readonly z: bigint;
  readonly hp: bigint;
}

export interface BotView {
  readonly self: UnitView | null;
  readonly allies: readonly UnitView[];
  readonly enemies: readonly UnitView[];
}

export interface BotMemory {
  target: number;
  phase: number;
}
