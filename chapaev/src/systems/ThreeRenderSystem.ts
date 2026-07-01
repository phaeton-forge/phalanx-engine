import * as THREE from 'three';
import { GameSystem } from '@phalanx-engine/ecs';
import type { SystemContext } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import type { InterpolationSystem } from '@phalanx-engine/physics';
import { ComponentType } from '../components/Component.ts';
import type { TransformComponent, CheckerComponent, GameStateComponent } from '../components';
import { PhysicsBodySoASchema } from '../components';
import { STOP_THRESHOLD } from '../config/constants.ts';
import { createBoardMesh } from '../rendering/BoardMesh.ts';
import { createCheckerMesh } from '../rendering/CheckerMesh.ts';
import { EffectsManager } from '../rendering/EffectsManager.ts';
import {
  CHECKER_COLLISION,
  CHECKER_ELIMINATED,
  ROUND_STARTED,
} from '../events/GameEvents.ts';
import type {
  CheckerCollisionEvent,
  CheckerEliminatedEvent,
} from '../events/GameEvents.ts';

/**
 * ThreeRenderSystem — frame system that synchronises Three.js mesh
 * positions with the interpolated render transforms from InterpolationSystem.
 *
 * Also manages visual effects: team highlights, collision particles,
 * speed trails, and elimination visibility.
 */
export class ThreeRenderSystem extends GameSystem {
  /** Entity ID → Three.js mesh */
  private meshMap: Map<number, THREE.Mesh | THREE.Group> = new Map();
  private readonly scene: THREE.Scene;

  /** Visual effects manager */
  private effects!: EffectsManager;

  /** Cached game state reference */
  private gameState: GameStateComponent | null = null;

  /** Set of entity IDs whose mesh is managed by RapierVFXSystem (don't sync position) */
  private rapierManaged: Set<number> = new Set();

  /** Source of interpolated render transforms. */
  private readonly interpolationSystem: InterpolationSystem;

  constructor(scene: THREE.Scene, interpolationSystem: InterpolationSystem) {
    super();
    this.scene = scene;
    this.interpolationSystem = interpolationSystem;
  }

  /**
   * Resolve the render position for an entity: the interpolated sample when
   * available, otherwise the raw fixed-point transform (used before the first
   * interpolation snapshot, e.g. at init / round start).
   */
  private renderPosition(
    entityId: number,
    transform: TransformComponent,
  ): { x: number; y: number; z: number } {
    const sample = this.interpolationSystem.getInterpolatedTransform(entityId);
    if (sample) return sample.position;
    const fp = transform.fpPosition;
    return { x: FP.ToFloat(fp.x), y: FP.ToFloat(fp.y), z: FP.ToFloat(fp.z) };
  }

  // ── Public accessors ──────────────────────────────────────────

  /**
   * Returns the mesh map for use by other systems (FlickInput, RapierVFX).
   */
  public getMeshMap(): Map<number, THREE.Mesh | THREE.Group> {
    return this.meshMap;
  }

  /**
   * Retrieve a single mesh by entity ID.
   */
  public getMesh(entityId: number): THREE.Mesh | THREE.Group | undefined {
    return this.meshMap.get(entityId);
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  public override init(context: SystemContext): void {
    super.init(context);

    this.effects = new EffectsManager(this.scene);

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

      // Store entity metadata on the mesh for raycasting
      mesh.userData['entityId'] = entity.id;
      mesh.userData['team'] = checker.team;

      // Set initial position from transform
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (transform) {
        const p = this.renderPosition(entity.id, transform);
        mesh.position.set(p.x, p.y, p.z);
      }

      this.scene.add(mesh);
      this.meshMap.set(entity.id, mesh);
    }

    // Resolve game state (may not exist yet if registered after this system)
    this.resolveGameState();

    // Subscribe to events
    this.subscribe<CheckerCollisionEvent>(CHECKER_COLLISION, (e) => {
      this.effects.spawnCollisionParticles(e.x, e.y, e.z);
    });

    this.subscribe<CheckerEliminatedEvent>(CHECKER_ELIMINATED, (e) => {
      this.rapierManaged.add(e.entityId);
    });

    this.subscribe(ROUND_STARTED, () => {
      this.rapierManaged.clear();
      // Reset all checker meshes for the new round
      const entities = this.entityManager.queryEntities(
        ComponentType.Checker,
        ComponentType.Transform,
      );
      for (const entity of entities) {
        const mesh = this.meshMap.get(entity.id);
        if (!mesh) continue;

        mesh.visible = true;

        // Reset rotation (Rapier may have tumbled the checker)
        mesh.quaternion.identity();

        // Snap position to the freshly-reset transform so the mesh
        // doesn't linger at the old Rapier-driven location for a frame.
        const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
        if (transform) {
          const p = this.renderPosition(entity.id, transform);
          mesh.position.set(p.x, p.y, p.z);
        }

        // Reset material opacity
        const target = mesh instanceof THREE.Group ? mesh.children[0] : mesh;
        if (target instanceof THREE.Mesh) {
          const mat = target.material as THREE.MeshStandardMaterial;
          mat.opacity = 1;
          mat.transparent = false;
        }
      }
    });
  }

  private resolveGameState(): void {
    const gsEntities = this.entityManager.queryEntities(ComponentType.GameState);
    if (gsEntities.length > 0) {
      this.gameState = gsEntities[0].getComponent<GameStateComponent>(ComponentType.GameState) ?? null;
    }
  }

  // ── Frame update ────────────────────────────────────────────────

  public override update(deltaTime: number): void {
    if (!this.gameState) {
      this.resolveGameState();
    }

    const pStore = this.entityManager.getSoAStore(PhysicsBodySoASchema);
    const checkerEntities = this.entityManager.queryEntities(ComponentType.Checker);

    for (const entity of checkerEntities) {
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      const mesh = this.meshMap.get(entity.id);
      if (!transform || !mesh) continue;

      // Skip meshes managed by Rapier (eliminated checkers)
      if (this.rapierManaged.has(entity.id)) continue;

      // Check alive status
      const checker = entity.getComponent<CheckerComponent>(ComponentType.Checker);
      if (checker && !checker.isAlive) {
        // Don't hide immediately — RapierVFXSystem will take over
        continue;
      }

      // Sync position from the interpolated render transform
      const p = this.renderPosition(entity.id, transform);
      mesh.position.set(p.x, p.y, p.z);

      // ── Team highlight ──────────────────────────────────────────
      if (this.gameState && checker) {
        const isCurrentTeam = checker.team === this.gameState.currentTeam;
        const isAiming = this.gameState.phase === 'aiming';
        this.effects.setTeamHighlight(mesh, isCurrentTeam && isAiming, checker.team);
      }

      // ── Speed trail ─────────────────────────────────────────────
      if (pStore) {
        const pi = pStore.indexOf(entity.id);
        if (pi !== -1) {
          const vx = FP.ToFloat(FP.FromRaw(pStore.arrays.velocityX[pi]));
          const vz = FP.ToFloat(FP.FromRaw(pStore.arrays.velocityZ[pi]));
          const speed = Math.sqrt(vx * vx + vz * vz);
          if (speed > STOP_THRESHOLD) {
            this.effects.updateTrail(entity.id, p.x, p.y, p.z, speed);
          } else {
            this.effects.removeTrail(entity.id);
          }
        } else {
          this.effects.removeTrail(entity.id);
        }
      }
    }

    // Update particle bursts
    this.effects.update(deltaTime);

    // Animate glowing checker pulse
    this.effects.updateGlowPulse(deltaTime);
  }

  // ── Cleanup ─────────────────────────────────────────────────

  public override dispose(): void {
    super.dispose();
    for (const [, obj] of this.meshMap) {
      this.scene.remove(obj);
      if (obj instanceof THREE.Mesh) {
        obj.geometry?.dispose();
      }
    }
    this.meshMap.clear();
    this.effects.dispose();
  }
}

