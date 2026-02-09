import {
  PointerEventTypes,
  PointerInfo,
  PickingInfo,
} from '@babylonjs/core';
import type { SystemContext } from '../core/SystemContext';
import { GameSystem } from './GameSystem';
import type { SelectionSystem } from './SelectionSystem';
import type { SceneManager } from '../core/SceneManager';
import { GameEvents, createEvent } from '../events';
import type { MoveCompletedEvent, HideDestinationMarkerEvent } from '../events';

/**
 * InputManager - Handles all user input
 * Uses EventBus for decoupled command issuing
 * Extends GameSystem for consistent lifecycle management
 */
export class InputManager extends GameSystem {
  private selectionSystem: SelectionSystem;
  private sceneManager: SceneManager;

  // Track entities that are moving to hide marker when all complete
  private movingEntities: Set<number> = new Set();

  constructor(
    selectionSystem: SelectionSystem,
    sceneManager: SceneManager
  ) {
    super();
    this.selectionSystem = selectionSystem;
    this.sceneManager = sceneManager;
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
    this.setupPointerObserver();
    this.setupEventListeners();
  }

  private setupPointerObserver(): void {
    this.context.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        this.handlePointerDown(pointerInfo);
      }
    });
  }

  private setupEventListeners(): void {
    // Listen for move completed to potentially hide destination marker
    this.subscribe<MoveCompletedEvent>(
      GameEvents.MOVE_COMPLETED,
      (event) => {
        this.movingEntities.delete(event.entityId);
        if (this.movingEntities.size === 0) {
          // Emit hide destination marker event
          this.eventBus.emit<HideDestinationMarkerEvent>(
            GameEvents.HIDE_DESTINATION_MARKER,
            {
              ...createEvent(),
            }
          );
        }
      }
    );
  }

  private handlePointerDown(pointerInfo: PointerInfo): void {
    const evt = pointerInfo.event as PointerEvent;
    const pickResult = pointerInfo.pickInfo;

    if (!pickResult?.hit) return;

    switch (evt.button) {
      case 0: // Left click - Selection
        this.handleLeftClick(pickResult);
        break;
    }
  }

  private handleLeftClick(pickResult: PickingInfo): void {
    const pickedMesh = pickResult.pickedMesh;
    const ground = this.sceneManager.getGround();

    if (!pickedMesh) {
      return;
    }

    // Check if we clicked on a selectable entity
    const selectable = this.selectionSystem.findSelectableByMesh(pickedMesh);

    if (selectable) {
      if (selectable.isSelected) {
        // Clicking on already selected entity - deselect it
        this.selectionSystem.deselectEntity(selectable);
      } else {
        // Clicking on a new entity - deselect all others first, then select this one
        this.selectionSystem.deselectAll();
        this.selectionSystem.selectEntity(selectable);
      }
    } else if (pickedMesh === ground) {
      // Clicked on empty ground - deselect all
      this.selectionSystem.deselectAll();
    }
  }

  /**
   * Dispose and unsubscribe from all events
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.movingEntities.clear();
  }
}
