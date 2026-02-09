import {
  PointerEventTypes,
  PointerInfo,
  PickingInfo,
} from '@babylonjs/core';
import type { SystemContext } from '../core/SystemContext';
import { GameSystem } from './GameSystem';

/**
 * InputManager - Handles all user input
 * Uses EventBus for decoupled command issuing
 * Extends GameSystem for consistent lifecycle management
 */
export class InputManager extends GameSystem {
  constructor() {
    super();
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
    this.setupPointerObserver();
  }

  private setupPointerObserver(): void {
    this.context.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        this.handlePointerDown(pointerInfo);
      }
    });
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

    if (!pickedMesh) {
      return;
    }
  }

  /**
   * Dispose and unsubscribe from all events
   */
  public override dispose(): void {
    super.dispose();
  }
}
