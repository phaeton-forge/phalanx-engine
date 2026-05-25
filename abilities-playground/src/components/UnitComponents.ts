import type * as THREE from 'three';
import { FP } from 'phalanx-math';
import type { FixedPoint } from 'phalanx-math';
import type { IComponent } from './Component';
import { ComponentType } from './Component';
import type { UnitKind } from '../config/unitRoster';

export type TeamId = 0 | 1;

export class TeamComponent implements IComponent {
  public readonly type = ComponentType.Team;
  public readonly teamId: TeamId;

  constructor(teamId: TeamId) {
    this.teamId = teamId;
  }
}

export class UnitTypeComponent implements IComponent {
  public readonly type = ComponentType.UnitType;
  public readonly kind: UnitKind;

  constructor(kind: UnitKind) {
    this.kind = kind;
  }
}

export class UnitStatsComponent implements IComponent {
  public readonly type = ComponentType.UnitStats;
  public readonly stopRange: FixedPoint;
  public alive = true;

  constructor(config: { stopRange: number }) {
    this.stopRange = FP.FromFloat(config.stopRange);
  }
}

export class TargetStateComponent implements IComponent {
  public readonly type = ComponentType.TargetState;
  public targetEntityId: number | null = null;
}

export class RenderRefsComponent implements IComponent {
  public readonly type = ComponentType.RenderRefs;
  public readonly root: THREE.Object3D;

  constructor(root: THREE.Object3D) {
    this.root = root;
  }
}

export class HealthBarComponent implements IComponent {
  public readonly type = ComponentType.HealthBar;
  public readonly root: THREE.Object3D;
  public readonly fill: THREE.Object3D;
  public readonly fullWidth: number;

  constructor(
    root: THREE.Object3D,
    fill: THREE.Object3D,
    fullWidth: number,
  ) {
    this.root = root;
    this.fill = fill;
    this.fullWidth = fullWidth;
  }
}

export class DeathFadeComponent implements IComponent {
  public readonly type = ComponentType.DeathFade;
  public elapsed = 0;
  public readonly duration: number;

  constructor(duration = 0.6) {
    this.duration = duration;
  }
}

export class HealerAuraLinkComponent implements IComponent {
  public readonly type = ComponentType.HealerAuraLink;
  public auraEntityId: number | null;

  constructor(auraEntityId: number | null = null) {
    this.auraEntityId = auraEntityId;
  }
}

export class ConeBeamComponent implements IComponent {
  public readonly type = ComponentType.ConeBeam;
  public primaryTargetId: number | null = null;
  public secondaryTargetId: number | null = null;
}

export class SimulationStateComponent implements IComponent {
  public readonly type = ComponentType.SimulationState;
  public active = false;
  public startedByPlayerId: string | null = null;
  public gameOver = false;
  public winner: 0 | 1 | null = null;
}
