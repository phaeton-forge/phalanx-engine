import type { UnitType, UnitGridSize } from './UnitType';

/** View-layer description (geometry + decorations). Data, not behavior. */
export interface UnitVisualSpec {
  readonly shape:
    'sphere' | 'box' | 'cone' | 'octahedron' | 'volt' | 'plasmaTank';
  readonly size: number; // sphere radius / box edge / cone radius / etc.
  readonly hasSpawnArrow: boolean;
  readonly hasAuraRing: boolean;
}

export interface UnitDefinition {
  readonly type: UnitType;

  // --- simulation data (common to every unit) ---
  readonly radius: number;
  readonly mass: number;
  readonly stopRange: number;
  readonly maxHealth: number;
  readonly detectionRange: number;
  readonly heightOffset: number;
  readonly gridSize: UnitGridSize;
  readonly abilities: readonly string[]; // GAS ability ids

  // --- optional components, expressed as DATA (this IS the differentiation) ---
  readonly hasAutoAttackTimer: boolean; // → AutoAttackTimerComponent
  readonly hasCubeState: boolean; // → CubeStateComponent
  readonly aura?: { readonly radius: number; readonly pulseTicks: number }; // → HealAuraComponent
  readonly autoAttack?: {
    readonly abilityId: string;
    readonly cooldownTicks: number;
  };

  readonly visual: UnitVisualSpec;
}
