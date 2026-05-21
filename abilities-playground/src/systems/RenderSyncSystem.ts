import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import { GameSystem } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import { teamColors } from '../config/constants';
import {
  ComponentType,
  LifecycleComponent,
  TargetingComponent,
  TransformComponent,
  UnitComponent,
  VisualComponent,
} from '../components';
import type { AbilityContext, GameRuntimeState } from '../core/types';

export class RenderSyncSystem extends GameSystem {
  public constructor(
    private readonly scene: Scene,
    private readonly state: GameRuntimeState,
    private readonly abilities: AbilityContext
  ) {
    super();
  }

  public override update(deltaTime: number): void {
    this.state.beamPulseTime += deltaTime;
    const entities = this.entityManager.queryEntities(ComponentType.Unit);

    for (const entity of entities) {
      const transform = entity.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      const visual = entity.getComponent<VisualComponent>(ComponentType.Visual);
      const unit = entity.getComponent<UnitComponent>(ComponentType.Unit);
      const life = entity.getComponent<LifecycleComponent>(
        ComponentType.Lifecycle
      );
      const targeting = entity.getComponent<TargetingComponent>(
        ComponentType.Targeting
      );
      if (!transform || !visual || !unit || !life) continue;

      const x = FP.ToFloat(transform.x);
      const z = FP.ToFloat(transform.z);
      visual.mesh.position.x = x;
      visual.mesh.position.z = z;

      const health = this.abilities.facade.getAttribute(
        entity.id,
        'Health'
      ).current;
      const hpRatio = Math.max(
        0,
        Math.min(1, FP.ToFloat(FP.Div(health, unit.maxHp)))
      );
      visual.hpBar.position = new Vector3(x, 4.5, z);
      visual.hpBar.scaling.x = hpRatio;
      visual.hpBar.position.x = x - (2 - 2 * hpRatio);

      if (visual.auraRing) {
        visual.auraRing.position = new Vector3(x, 0.1, z);
        const auraMaterial = visual.auraRing.material as StandardMaterial;
        auraMaterial.alpha = 0.4 + Math.sin(this.state.beamPulseTime * 5) * 0.2;
      }

      if (!life.alive && life.dyingSinceTick !== null) {
        const fade = Math.max(
          0,
          1 - (this.state.currentTick - life.dyingSinceTick) / 20
        );
        const material = visual.mesh.material as StandardMaterial;
        material.alpha = fade;
      }

      if (unit.unitType === 'cone' && targeting) {
        this.syncBeam(entity.id, visual, targeting, x, z);
      }
    }
  }

  private syncBeam(
    entityId: number,
    visual: VisualComponent,
    targeting: TargetingComponent,
    x: number,
    z: number
  ): void {
    const source = new Vector3(x, 3.5, z);
    const beamDefs: Array<{
      targetId: number | null;
      index: 0 | 1 | 2;
      color: Color3;
    }> = [
      {
        targetId: targeting.illuminatedTargetIds[0],
        index: 0,
        color: new Color3(1, 1, 0.6),
      },
      {
        targetId: targeting.illuminatedTargetIds[1],
        index: 1,
        color: new Color3(1, 1, 0.6),
      },
      {
        targetId: targeting.jammedTargetId,
        index: 2,
        color: new Color3(1, 0.4, 0.1),
      },
    ];

    for (const beamDef of beamDefs) {
      const targetTransform =
        beamDef.targetId !== null
          ? this.entityManager
              .getEntity(beamDef.targetId)
              ?.getComponent<TransformComponent>(ComponentType.Transform)
          : undefined;

      const target = targetTransform
        ? new Vector3(
            FP.ToFloat(targetTransform.x),
            3.5,
            FP.ToFloat(targetTransform.z)
          )
        : new Vector3(source.x, source.y, source.z);

      const name = `beam-${entityId}-${beamDef.index}`;
      const current = visual.beamLines[beamDef.index];
      const updated = MeshBuilder.CreateLines(
        name,
        {
          points: [source, target],
          updatable: true,
          instance: current ?? undefined,
        },
        this.scene
      );

      updated.color = beamDef.color;
      updated.alpha =
        beamDef.targetId === null ? 0 : beamDef.index === 2 ? 0.85 : 0.65;
      visual.beamLines[beamDef.index] = updated;
    }

    const coneMaterial = visual.mesh.material as StandardMaterial;
    const baseColor = Color3.FromHexString(
      this.entityManager
        .getEntity(entityId)
        ?.getComponent<UnitComponent>(ComponentType.Unit)?.teamId === 1
        ? teamColors.team1
        : teamColors.team2
    );
    coneMaterial.emissiveColor = baseColor.scale(0.35);
  }
}
