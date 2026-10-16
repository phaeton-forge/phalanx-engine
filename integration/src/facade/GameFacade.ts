/**
 * The minimum the skirmish rules need. Implementations live in
 * `facade/current.ts` (today) and, after Task 6.5b, `facade/v65.ts`.
 * Rules never import the engine.
 */
export interface GameFacade {
  /** Draws the match RNG. The value changes damage and which unit drifts. */
  drawRng(): number;
  eachUnit(fn: (id: number) => void): void;
  kindOf(id: number): number;
  teamOf(id: number): number;
  slotOf(id: number): number;
  hp(id: number): bigint;
  hasTag(id: number, tag: string): boolean;
  near(a: number, b: number, rangeRaw: bigint): boolean;
  /** True when the last physics tick reported a narrowphase contact. */
  bodiesTouching(a: number, b: number): boolean;
  /** Contacts reported by the narrowphase since the match started. */
  contactCount(): number;
  applyEffect(target: number, effectId: string, source: number): void;
  kill(id: number, respawn: boolean): void;
  flushRespawns(tick: number): void;
  livingTeams(): number;
  pendingRespawns(): number;
  /**
   * Move homeX, homeZ, range and velocity so a save/load bug on any of
   * those fields is visible. `focus` also bumps that unit's health by
   * one raw step, which is how the match RNG enters the rules.
   */
  drift(id: number, roll: number, focus: boolean): void;
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

export interface BotNote {
  phase: string;
  target: string;
  rng: string;
}
