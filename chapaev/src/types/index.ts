import type { FPVector3 as FPVector3Type } from '@phalanx-engine/math';

/** Entity ID → Three.js mesh binding */
export interface MeshBinding {
  readonly entityId: number;
  readonly meshIndex: number;
}

/** Checker initial placement descriptor */
export interface CheckerPlacement {
  readonly team: 'white' | 'black';
  readonly position: FPVector3Type;
}

