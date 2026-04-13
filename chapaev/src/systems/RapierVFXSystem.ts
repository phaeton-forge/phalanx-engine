import * as THREE from 'three';
import { GameSystem } from 'phalanx-ecs';
import type { SystemContext } from 'phalanx-ecs';
import {
  CHECKER_ELIMINATED,
  ROUND_STARTED,
} from '../events/GameEvents.ts';
import type {
  CheckerEliminatedEvent,
} from '../events/GameEvents.ts';
import {
  BOARD_HEIGHT,
  BOARD_HALF_EXTENT,
  BOARD_RIM_WIDTH,
  BOARD_EXTENT,
  CHECKER_RADIUS,
  CHECKER_HEIGHT,
  TABLE_SIZE,
  TABLE_BORDER_THICKNESS,
  TABLE_BORDER_HEIGHT,
} from '../config/constants.ts';

/**
 * Tracked eliminated checker in the Rapier world.
 */
interface EliminatedBody {
  entityId: number;
  mesh: THREE.Mesh | THREE.Group;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rigidBody: any;
}

/**
 * RapierVFXSystem — frame system that uses @dimforge/rapier3d-compat
 * to simulate realistic 3D falling of eliminated checkers.
 *
 * Rapier manages **only** eliminated checkers. Live checkers remain under
 * the deterministic PhysicsSystem (FixedPoint).
 *
 * Eliminated checkers stay on the table permanently and participate in
 * collisions with other falling checkers — they never fade out or disappear.
 *
 * Registered as a frame system AFTER ThreeRenderSystem.
 */
export class RapierVFXSystem extends GameSystem {
  /** Mesh map from ThreeRenderSystem (set externally) */
  private meshMap!: Map<number, THREE.Mesh | THREE.Group>;

  /** Rapier module (loaded async) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private RAPIER: any = null;
  /** Rapier physics world */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private rapierWorld: any = null;
  /** Whether Rapier has finished initialising */
  private rapierReady = false;

  /** Active eliminated bodies (persist for the entire round) */
  private bodies: EliminatedBody[] = [];

  /** Queued eliminations received before Rapier was ready */
  private pendingEliminations: CheckerEliminatedEvent[] = [];

  constructor() {
    super();
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  public override init(context: SystemContext): void {
    super.init(context);

    this.subscribe<CheckerEliminatedEvent>(CHECKER_ELIMINATED, (e) => this.onCheckerEliminated(e));

    // On new round, remove all Rapier bodies so the table is clean
    this.subscribe(ROUND_STARTED, () => this.clearBodies());

    // Start async Rapier initialisation
    this.initRapier();
  }

  /**
   * Set the mesh map reference (call after ThreeRenderSystem.init).
   */
  public setMeshMap(map: Map<number, THREE.Mesh | THREE.Group>): void {
    this.meshMap = map;
  }

  // ── Async Rapier init ──────────────────────────────────────────

  private async initRapier(): Promise<void> {
    try {
      const RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();

      this.RAPIER = RAPIER;
      this.rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

      // ── Static colliders ────────────────────────────────────────

      // Table surface (below the board)
      const tableY = -BOARD_HEIGHT / 2 - 0.01;
      const tableBody = this.rapierWorld.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, tableY, 0),
      );
      this.rapierWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(TABLE_SIZE / 2, 0.05, TABLE_SIZE / 2)
          .setRestitution(0.2).setFriction(0.6),
        tableBody,
      );

      // Board deck — single solid cuboid matching the visual mesh
      // (BoxGeometry with rimTotal = BOARD_EXTENT + BOARD_RIM_WIDTH * 2, centered at y=0).
      // Eliminated checkers roll across the full deck surface and fall
      // off the edges naturally — no separate rim walls needed.
      const deckHalf = BOARD_HALF_EXTENT + BOARD_RIM_WIDTH; // 4.3
      const deckBody = this.rapierWorld.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
      );
      this.rapierWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(deckHalf, BOARD_HEIGHT / 2, deckHalf)
          .setRestitution(0.1).setFriction(0.5),
        deckBody,
      );

      // ── Table border / raised rails (the outer wooden rim) ──────
      // These match the visual geometry created in SceneSetup.ts.
      const tableHalf = TABLE_SIZE / 2;
      const borderY = -BOARD_EXTENT * 0.02 + TABLE_BORDER_HEIGHT / 2;

      // Long sides (along X) — front and back
      const longHW = TABLE_SIZE / 2;
      const longHH = TABLE_BORDER_HEIGHT / 2;
      const longHD = TABLE_BORDER_THICKNESS / 2;
      const longZ = tableHalf - TABLE_BORDER_THICKNESS / 2;

      // Short sides (along Z) — left and right (inner length)
      const innerLen = TABLE_SIZE - TABLE_BORDER_THICKNESS * 2;
      const shortHW = TABLE_BORDER_THICKNESS / 2;
      const shortHH = TABLE_BORDER_HEIGHT / 2;
      const shortHD = innerLen / 2;
      const shortX = tableHalf - TABLE_BORDER_THICKNESS / 2;

      const tableBorderPositions: [number, number, number, number, number, number][] = [
        [ 0,       borderY, -longZ, longHW,  longHH,  longHD],   // back  (-Z)
        [ 0,       borderY,  longZ, longHW,  longHH,  longHD],   // front (+Z)
        [-shortX,  borderY,  0,     shortHW, shortHH, shortHD],  // left  (-X)
        [ shortX,  borderY,  0,     shortHW, shortHH, shortHD],  // right (+X)
      ];

      for (const [px, py, pz, hw, hh, hd] of tableBorderPositions) {
        const body = this.rapierWorld.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(px, py, pz),
        );
        this.rapierWorld.createCollider(
          RAPIER.ColliderDesc.cuboid(hw, hh, hd).setRestitution(0.4).setFriction(0.5),
          body,
        );
      }

      this.rapierReady = true;

      // Process any pending eliminations
      for (const pending of this.pendingEliminations) {
        this.spawnRapierBody(pending);
      }
      this.pendingEliminations = [];
    } catch (err) {
      console.warn('RapierVFXSystem: Failed to initialise Rapier. Eliminated checker VFX disabled.', err);
    }
  }

  // ── Elimination handler ────────────────────────────────────────

  private onCheckerEliminated(event: CheckerEliminatedEvent): void {
    if (!this.rapierReady) {
      this.pendingEliminations.push(event);
      return;
    }
    this.spawnRapierBody(event);
  }

  private spawnRapierBody(event: CheckerEliminatedEvent): void {
    if (!this.RAPIER || !this.rapierWorld || !this.meshMap) return;

    const mesh = this.meshMap.get(event.entityId);
    if (!mesh) return;

    const RAPIER = this.RAPIER;

    // Create dynamic rigid body at the checker's last position with its velocity
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(event.posX, event.posY, event.posZ)
      .setLinvel(event.velX, 0, event.velZ)
      .setCcdEnabled(true);

    const rigidBody = this.rapierWorld.createRigidBody(bodyDesc);

    // Cylinder collider matching checker dimensions
    const colliderDesc = RAPIER.ColliderDesc.cylinder(CHECKER_HEIGHT / 2, CHECKER_RADIUS)
      .setRestitution(0.3)
      .setFriction(0.5)
      .setDensity(1.0);

    this.rapierWorld.createCollider(colliderDesc, rigidBody);

    // Ensure mesh is visible (ThreeRenderSystem may have skipped it)
    mesh.visible = true;

    this.bodies.push({ entityId: event.entityId, mesh, rigidBody });
  }

  // ── Frame update ───────────────────────────────────────────────

  public override update(deltaTime: number): void {
    if (!this.rapierReady || !this.rapierWorld) return;

    // Step Rapier world
    this.rapierWorld.timestep = deltaTime;
    this.rapierWorld.step();

    // Sync mesh transforms from Rapier bodies
    for (const entry of this.bodies) {
      const pos = entry.rigidBody.translation();
      const rot = entry.rigidBody.rotation();
      entry.mesh.position.set(pos.x, pos.y, pos.z);
      entry.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
  }

  // ── Round reset ────────────────────────────────────────────────

  /**
   * Remove all Rapier dynamic bodies (called on ROUND_STARTED).
   */
  private clearBodies(): void {
    if (!this.rapierWorld) return;
    for (const entry of this.bodies) {
      this.rapierWorld.removeRigidBody(entry.rigidBody);
    }
    this.bodies = [];
  }

  // ── Cleanup ────────────────────────────────────────────────────

  public override dispose(): void {
    super.dispose();

    if (this.rapierWorld) {
      this.clearBodies();
      this.rapierWorld.free();
      this.rapierWorld = null;
    }
  }
}

