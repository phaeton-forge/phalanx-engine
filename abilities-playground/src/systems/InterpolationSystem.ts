import { GameSystem } from 'phalanx-ecs';
import type { CommandsBatch } from 'phalanx-ecs';
import type { IBeforeTick, IAfterTick, IAfterFrame } from 'phalanx-ecs';
import { FPVector3 } from 'phalanx-math';
import {
  ComponentType,
  InterpolationComponent,
  MeshComponent,
  TransformComponent,
} from '../components';

export class InterpolationSystem
  extends GameSystem
  implements IBeforeTick, IAfterTick, IAfterFrame
{
  // IBeforeTick ─────────────────────────────────────────────────────────────

  beforeTick(_tick: number, _commands: CommandsBatch): void {
    this.snapshotPositions();
  }

  // IAfterTick ──────────────────────────────────────────────────────────────

  afterTick(_tick: number): void {
    this.captureCurrentPositions();
  }

  // IAfterFrame ─────────────────────────────────────────────────────────────

  afterFrame(alpha: number, _dt: number): void {
    this.interpolate(alpha);
  }

  // ── Public helpers (also callable explicitly when needed) ─────────────────

  snapshotPositions(): void {
    const entities = this.entityManager.queryEntities(ComponentType.Interpolation);
    for (const entity of entities) {
      const interpolation = entity.getComponent<InterpolationComponent>(
        ComponentType.Interpolation,
      );
      if (interpolation?.active) {
        interpolation.snapshotPosition();
      }
    }
  }

  captureCurrentPositions(): void {
    const entities = this.entityManager.queryEntities(
      ComponentType.Interpolation,
      ComponentType.Transform,
    );
    for (const entity of entities) {
      const interpolation = entity.getComponent<InterpolationComponent>(
        ComponentType.Interpolation,
      );
      const transform = entity.getComponent<TransformComponent>(
        ComponentType.Transform,
      );
      if (!interpolation?.active || !transform) continue;
      interpolation.capturePosition(transform.fpPosition);
    }
  }

  interpolate(alpha: number): void {
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    const entities = this.entityManager.queryEntities(
      ComponentType.Interpolation,
      ComponentType.Mesh,
    );

    for (const entity of entities) {
      const interpolation = entity.getComponent<InterpolationComponent>(
        ComponentType.Interpolation,
      );
      const entityMesh = entity.getComponent<MeshComponent>(
        ComponentType.Mesh,
      );
      if (!interpolation?.active || !entityMesh) continue;

      const previous = FPVector3.ToFloat(interpolation.previousFpPosition);
      const current = FPVector3.ToFloat(interpolation.currentFpPosition);
      interpolation.visualPosition.set(
        previous.x + (current.x - previous.x) * clampedAlpha,
        previous.y + (current.y - previous.y) * clampedAlpha,
        previous.z + (current.z - previous.z) * clampedAlpha,
      );
      entityMesh.root.position.copy(interpolation.visualPosition);
    }
  }

  snapToCurrentPositions(): void {
    this.captureCurrentPositions();
    this.interpolate(1);
  }
}
