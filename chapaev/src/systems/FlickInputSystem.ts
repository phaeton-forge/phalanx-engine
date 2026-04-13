import * as THREE from 'three';
import { GameSystem } from 'phalanx-ecs';
import type { SystemContext } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
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

/**
 * FlickInputSystem — frame system that handles mouse/touch aiming and flicking.
 *
 * Slingshot mechanic: drag backwards from a checker → arrow shows flight direction.
 * On release the checker receives an impulse in the opposite direction of the drag.
 *
 * Works only during the `aiming` phase for the current team's checkers.
 */
export class FlickInputSystem extends GameSystem {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLElement;
  private readonly scene: THREE.Scene;
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

  // ── Bound event handlers (for removal) ─────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => this.handlePointerDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e);
  private readonly onPointerUp = (_e: PointerEvent): void => this.handlePointerUp();
  private readonly onTouchStart = (e: TouchEvent): void => this.handleTouchStart(e);
  private readonly onTouchMove = (e: TouchEvent): void => this.handleTouchMove(e);
  private readonly onTouchEnd = (_e: TouchEvent): void => this.handlePointerUp();

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement, scene: THREE.Scene) {
    super();
    this.camera = camera;
    this.canvas = domElement;
    this.scene = scene;
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

  public override update(_deltaTime: number): void {
    // Nothing to tick — input is entirely event-driven.
    // Aim visuals are updated in pointer move handlers.
  }

  // ── Pointer / Touch handlers ───────────────────────────────────

  private handlePointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (this.gameState.phase !== 'aiming') return;

    this.setMouseFromEvent(e);
    this.tryStartDrag();
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.enabled || !this.dragging) return;
    this.setMouseFromEvent(e);
    this.updateDrag();
  }

  private handlePointerUp(): void {
    if (!this.dragging) return;
    this.releaseDrag();
  }

  private handleTouchStart(e: TouchEvent): void {
    if (!this.enabled) return;
    if (this.gameState.phase !== 'aiming') return;
    if (e.touches.length === 0) return;
    e.preventDefault();
    this.setMouseFromTouch(e.touches[0]);
    this.tryStartDrag();
  }

  private handleTouchMove(e: TouchEvent): void {
    if (!this.enabled || !this.dragging) return;
    if (e.touches.length === 0) return;
    e.preventDefault();
    this.setMouseFromTouch(e.touches[0]);
    this.updateDrag();
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

  private tryStartDrag(): void {
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
    if (intersects.length === 0) return;

    // Find the entity
    let hitObject: THREE.Object3D | null = intersects[0].object;
    let eid = entityIdByObject.get(hitObject);
    while (!eid && hitObject?.parent) {
      hitObject = hitObject.parent;
      eid = entityIdByObject.get(hitObject);
    }
    if (eid === undefined) return;

    this.dragEntityId = eid;
    this.dragging = true;

    // Record start world position of the checker
    const mesh = this.meshMap.get(eid)!;
    this.dragStartWorld.copy(mesh.position);
    this.dragCurrentWorld.copy(this.dragStartWorld);
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
    this.aimVisuals.hide();

    if (this.dragEntityId === -1) {
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
      this.dragEntityId = -1;
      return;
    }

    const force = Math.min(dragLen * FLICK_FORCE_MULTIPLIER, MAX_FLICK_FORCE);
    const dirX = dx / dragLen;
    const dirZ = dz / dragLen;

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


