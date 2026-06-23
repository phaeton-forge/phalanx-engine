import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GameSystem } from '@phalanx-engine/ecs';
import type { SystemContext } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { ComponentType } from '../components/Component.ts';
import type { GameStateComponent } from '../components/GameStateComponent.ts';
import type { CheckerComponent } from '../components/CheckerComponent.ts';
import { AimingVisuals } from '../rendering/AimingVisuals.ts';
import { TeamTag } from '../enums/TeamTag.ts';
import { MAX_FLICK_FORCE, FLICK_FORCE_MULTIPLIER, BOARD_HEIGHT, CHECKER_HEIGHT } from '../config/constants.ts';
import {
  FLICK_EXECUTED,
} from '../events/GameEvents.ts';
import type { FlickExecutedEvent } from '../events/GameEvents.ts';
import type { LockstepManager, FlickCommandData } from '../network/LockstepManager.ts';

/**
 * FlickInputSystem — frame system that handles mouse/touch aiming and flicking.
 *
 * Slingshot mechanic: drag backwards from a checker → arrow shows flight direction.
 * On release the checker receives an impulse in the opposite direction of the drag.
 *
 * Automatically detects whether the pointer lands on a checker belonging to the
 * current team. If it does → orbit controls are disabled and aiming begins.
 * If not (or if multiple fingers are detected, i.e. pinch-to-zoom) → orbit
 * controls stay active for camera manipulation.
 *
 * Works only during the `aiming` phase for the current team's checkers.
 */
export class FlickInputSystem extends GameSystem {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLElement;
  private readonly scene: THREE.Scene;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly mouse = new THREE.Vector2();

  /** Aiming arrow visualisation */
  private aimVisuals!: AimingVisuals;

  /** Mesh map from ThreeRenderSystem (set externally after init) */
  private meshMap!: Map<number, THREE.Mesh | THREE.Group>;

  // ── Drag state ─────────────────────────────────────────────────

  /** Entity ID of the checker being aimed, or -1 */
  private dragEntityId = -1;

  /** World-space XZ of the drag start (on the checker) */
  private dragStartWorld = new THREE.Vector3();

  /** Current pointer position in world XZ */
  private dragCurrentWorld = new THREE.Vector3();

  /** Whether we are in an active drag */
  private dragging = false;

  /** Cached game-state reference */
  private gameState!: GameStateComponent;

  /** Reusable ground plane for raycasting pointer position to world XZ */
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(BOARD_HEIGHT / 2 + CHECKER_HEIGHT / 2));

  // ── Network mode ──────────────────────────────────────────────

  /** Whether we are in online (network) mode */
  private networkMode = false;

  /** LockstepManager for sending commands in online mode */
  private lockstepManager: LockstepManager | null = null;

  /** Local player's team in online mode (null = hot-seat, both teams playable) */
  private localTeam: TeamTag | null = null;

  // ── Bound event handlers (for removal) ─────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e);
  private readonly onPointerUp = (_e: PointerEvent): void => this.handlePointerUp();
  private readonly onTouchStart = (e: TouchEvent): void => this.handleTouchStart(e);
  private readonly onTouchMove = (e: TouchEvent): void => this.handleTouchMove(e);
  private readonly onTouchEnd = (e: TouchEvent): void => this.handleTouchEnd(e);

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    scene: THREE.Scene,
    controls: OrbitControls,
  ) {
    super();
    this.camera = camera;
    this.canvas = domElement;
    this.scene = scene;
    this.controls = controls;
  }

  /**
   * Enable network mode. In this mode, flicks are sent as commands
   * via the LockstepManager instead of directly emitting FLICK_EXECUTED.
   * Input is also blocked when it's not the local player's turn.
   */
  public setNetworkMode(lockstepManager: LockstepManager, localTeam: TeamTag): void {
    this.networkMode = true;
    this.lockstepManager = lockstepManager;
    this.localTeam = localTeam;
  }

  /**
   * Restrict input to a single team without enabling network mode.
   * Used in AI mode to block the human from controlling the AI's checkers.
   */
  public setLocalTeam(team: TeamTag): void {
    this.localTeam = team;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  public override init(context: SystemContext): void {
    super.init(context);

    // Resolve game state
    const gsEntities = this.entityManager.queryEntities(ComponentType.GameState);
    this.gameState = gsEntities[0].getComponent<GameStateComponent>(ComponentType.GameState)!;

    this.aimVisuals = new AimingVisuals(this.scene);

    // Register input listeners
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd);
  }

  /**
   * Set the mesh map reference (call after ThreeRenderSystem.init).
   */
  public setMeshMap(map: Map<number, THREE.Mesh | THREE.Group>): void {
    this.meshMap = map;
  }

  // ── Frame update (visual only) ─────────────────────────────────

  public override update(deltaTime: number): void {
    // Input is event-driven, but the aiming arrow oscillates per-frame.
    this.aimVisuals.update(deltaTime);
  }

  // ── Pointer / Touch handlers ───────────────────────────────────

  /** Returns true if input should be blocked (locked to a team and it's not their turn) */
  private isInputBlocked(): boolean {
    if (!this.localTeam) return false;
    return this.gameState.currentTeam !== this.localTeam;
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (this.gameState.phase !== 'aiming') return;
    if (this.isInputBlocked()) return;

    // Pointer events from touch are handled in handleTouchStart
    if (e.pointerType === 'touch') return;

    this.setMouseFromEvent(e);
    if (this.tryStartDrag()) {
      // Checker hit — disable orbit controls while aiming
      this.controls.enabled = false;
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    if (e.pointerType === 'touch') return;
    this.setMouseFromEvent(e);
    this.updateDrag();
  }

  private handlePointerUp(): void {
    if (!this.dragging) return;
    this.releaseDrag();
    // Re-enable orbit controls after the drag ends
    this.controls.enabled = true;
  }

  private handleTouchStart(e: TouchEvent): void {
    if (!this.enabled) return;
    if (this.gameState.phase !== 'aiming') return;
    if (this.isInputBlocked()) return;

    // Multi-finger gesture (pinch-to-zoom) — let orbit controls handle it
    if (e.touches.length > 1) {
      if (this.dragging) {
        this.cancelDrag();
        this.controls.enabled = true;
      }
      return;
    }

    e.preventDefault();
    this.setMouseFromTouch(e.touches[0]);
    if (this.tryStartDrag()) {
      // Checker hit — disable orbit controls while aiming
      this.controls.enabled = false;
    }
  }

  private handleTouchMove(e: TouchEvent): void {
    // Multi-finger: cancel any in-progress drag, let orbit controls take over
    if (e.touches.length > 1) {
      if (this.dragging) {
        this.cancelDrag();
        this.controls.enabled = true;
      }
      return;
    }

    if (!this.dragging) return;
    e.preventDefault();
    this.setMouseFromTouch(e.touches[0]);
    this.updateDrag();
  }

  private handleTouchEnd(e: TouchEvent): void {
    // If there are still fingers left, don't release yet
    if (e.touches.length > 0) return;

    if (!this.dragging) return;
    this.releaseDrag();
    this.controls.enabled = true;
  }

  /**
   * Cancel any in-progress drag (called when the system is disabled mid-aim).
   */
  public cancelDrag(): void {
    if (!this.dragging) return;
    this.aimVisuals.hide();
    this.dragging = false;
    this.dragEntityId = -1;
  }

  // ── Drag logic ─────────────────────────────────────────────────

  /**
   * Attempt to start a drag on a checker under the pointer.
   * @returns `true` if a checker was hit and aiming started, `false` otherwise.
   */
  private tryStartDrag(): boolean {
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Gather meshes of current team's alive checkers
    const checkerEntities = this.entityManager.queryEntities(ComponentType.Checker);
    const targets: THREE.Object3D[] = [];
    const entityIdByObject = new Map<THREE.Object3D, number>();

    for (const entity of checkerEntities) {
      const checker = entity.getComponent<CheckerComponent>(ComponentType.Checker)!;
      if (checker.team !== this.gameState.currentTeam || !checker.isAlive) continue;

      const mesh = this.meshMap?.get(entity.id);
      if (!mesh) continue;
      targets.push(mesh);
      entityIdByObject.set(mesh, entity.id);

      // Also map children for Groups
      if (mesh instanceof THREE.Group) {
        for (const child of mesh.children) {
          entityIdByObject.set(child, entity.id);
        }
      }
    }

    const intersects = this.raycaster.intersectObjects(targets, true);
    if (intersects.length === 0) return false;

    // Find the entity
    let hitObject: THREE.Object3D | null = intersects[0].object;
    let eid = entityIdByObject.get(hitObject);
    while (!eid && hitObject?.parent) {
      hitObject = hitObject.parent;
      eid = entityIdByObject.get(hitObject);
    }
    if (eid === undefined) return false;

    this.dragEntityId = eid;
    this.dragging = true;

    // Record start world position of the checker
    const mesh = this.meshMap.get(eid)!;
    this.dragStartWorld.copy(mesh.position);
    this.dragCurrentWorld.copy(this.dragStartWorld);
    return true;
  }

  private updateDrag(): void {
    // Project mouse onto the ground plane at checker height
    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hitPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hitPoint)) return;

    this.dragCurrentWorld.copy(hitPoint);

    // Drag vector (from current pointer back to checker origin)
    const dx = this.dragStartWorld.x - this.dragCurrentWorld.x;
    const dz = this.dragStartWorld.z - this.dragCurrentWorld.z;

    // Force = length of drag * multiplier, capped at MAX_FLICK_FORCE
    const dragLen = Math.sqrt(dx * dx + dz * dz);
    const force = Math.min(dragLen * FLICK_FORCE_MULTIPLIER, MAX_FLICK_FORCE);

    if (dragLen < 0.01) {
      this.aimVisuals.hide();
      return;
    }

    // Direction = normalised drag (points from pointer toward checker = flight direction)
    const dirX = dx / dragLen;
    const dirZ = dz / dragLen;

    this.aimVisuals.show(
      this.dragStartWorld.x, this.dragStartWorld.y, this.dragStartWorld.z,
      dirX, dirZ,
      force, MAX_FLICK_FORCE,
    );
  }

  private releaseDrag(): void {
    if (this.dragEntityId === -1) {
      this.aimVisuals.hide();
      this.dragging = false;
      return;
    }

    // Compute impulse direction and force
    const dx = this.dragStartWorld.x - this.dragCurrentWorld.x;
    const dz = this.dragStartWorld.z - this.dragCurrentWorld.z;
    const dragLen = Math.sqrt(dx * dx + dz * dz);

    this.dragging = false;

    if (dragLen < 0.05) {
      // Too small — cancel
      this.aimVisuals.hide();
      this.dragEntityId = -1;
      return;
    }

    const force = Math.min(dragLen * FLICK_FORCE_MULTIPLIER, MAX_FLICK_FORCE);

    // Direction comes from the oscillating arrow (adds skill/difficulty).
    // Fall back to base direction if visuals aren't visible for any reason.
    let dirX = dx / dragLen;
    let dirZ = dz / dragLen;
    if (this.aimVisuals.isVisible) {
      const d = this.aimVisuals.getCurrentDirectionXZ();
      dirX = d.dirX;
      dirZ = d.dirZ;
    }

    this.aimVisuals.hide();

    if (this.networkMode && this.lockstepManager) {
      // Online mode: send command via lockstep — do NOT modify physics directly.
      // The command will arrive back in a commands-batch and be applied by
      // LockstepManager on all clients simultaneously.
      const fpDirX = FP.FromFloat(dirX);
      const fpDirZ = FP.FromFloat(dirZ);
      const fpForce = FP.FromFloat(force);

      const commandData: FlickCommandData = {
        entityId: this.dragEntityId,
        dirX: FP.ToRaw(fpDirX).toString(),
        dirZ: FP.ToRaw(fpDirZ).toString(),
        force: FP.ToRaw(fpForce).toString(),
      };

      this.lockstepManager.queueFlickCommand(commandData);
    } else {
      // Hot-seat mode: emit directly (original Stage 1 behaviour)
      const entity = this.entityManager.getEntity(this.dragEntityId);
      const checker = entity?.getComponent<CheckerComponent>(ComponentType.Checker);
      const team = checker?.team ?? TeamTag.White;

      this.eventBus.emit<FlickExecutedEvent>(FLICK_EXECUTED, {
        entityId: this.dragEntityId,
        team,
        directionX: FP.FromFloat(dirX),
        directionZ: FP.FromFloat(dirZ),
        force: FP.FromFloat(force),
      });
    }

    this.dragEntityId = -1;
  }

  // ── Helpers ────────────────────────────────────────────────────

  private setMouseFromEvent(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private setMouseFromTouch(t: Touch): void {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((t.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((t.clientY - rect.top) / rect.height) * 2 + 1;
  }

  // ── Cleanup ────────────────────────────────────────────────────

  public override dispose(): void {
    super.dispose();

    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);

    this.aimVisuals.dispose();
  }
}


