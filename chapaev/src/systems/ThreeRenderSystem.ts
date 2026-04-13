import * as THREE from 'three';
import { GameSystem } from 'phalanx-ecs';
import type { SystemContext } from 'phalanx-ecs';
import { ComponentType } from '../components/Component.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';
import type { CheckerComponent } from '../components/CheckerComponent.ts';
import { createBoardMesh } from '../rendering/BoardMesh.ts';
import { createCheckerMesh } from '../rendering/CheckerMesh.ts';

/**
 * ThreeRenderSystem — frame system that synchronises Three.js mesh
 * positions with `TransformComponent.visualPosition`.
 *
 * Registered as a **frame** system (not tick) so it runs every
 * render frame rather than on the deterministic tick.
 */
export class ThreeRenderSystem extends GameSystem {
  /** Entity ID → Three.js mesh */
  private meshMap: Map<number, THREE.Mesh | THREE.Group> = new Map();
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    super();
    this.scene = scene;
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  public override init(context: SystemContext): void {
    super.init(context);

    // Create board mesh for the board entity
    const boardEntities = this.entityManager.queryEntities(ComponentType.Board);
    for (const entity of boardEntities) {
      const boardGroup = createBoardMesh();
      this.scene.add(boardGroup);
      this.meshMap.set(entity.id, boardGroup);
    }

    // Create checker meshes
    const checkerEntities = this.entityManager.queryEntities(ComponentType.Checker);
    for (const entity of checkerEntities) {
      const checker = entity.getComponent<CheckerComponent>(ComponentType.Checker);
      if (!checker) continue;

      const mesh = createCheckerMesh(checker.team);

      // Set initial position from transform
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (transform) {
        mesh.position.set(
          transform.visualPositionX,
          transform.visualPositionY,
          transform.visualPositionZ,
        );
      }

      this.scene.add(mesh);
      this.meshMap.set(entity.id, mesh);
    }
  }

  // ─── Frame update ────────────────────────────────────────────

  public override update(_deltaTime: number): void {
    const checkerEntities = this.entityManager.queryEntities(ComponentType.Checker);
    for (const entity of checkerEntities) {
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      const mesh = this.meshMap.get(entity.id);
      if (!transform || !mesh) continue;

      mesh.position.set(
        transform.visualPositionX,
        transform.visualPositionY,
        transform.visualPositionZ,
      );
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────

  public override dispose(): void {
    super.dispose();
    for (const [, obj] of this.meshMap) {
      this.scene.remove(obj);
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
      }
    }
    this.meshMap.clear();
  }
}


