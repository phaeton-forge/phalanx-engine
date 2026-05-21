import type { IComponent } from 'phalanx-ecs';
import type { LinesMesh, Mesh } from '@babylonjs/core';
import { ComponentType } from './Component';

export class VisualComponent implements IComponent {
  public readonly type = ComponentType.Visual;

  public constructor(
    public mesh: Mesh,
    public hpBar: Mesh,
    public auraRing: Mesh | null,
    public beamLines: [LinesMesh | null, LinesMesh | null, LinesMesh | null]
  ) {}
}
