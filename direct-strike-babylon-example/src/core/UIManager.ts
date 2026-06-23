import type { EventBus } from '@phalanx-engine/ecs';
import { GameEvents } from '../events';
import type { UIResourcesUpdatedEvent, UIFormationUpdatedEvent } from '../events';
import { pauseConfig } from '../config/constants';

/**
 * Unit type for placement
 */
export type UnitType = 'mutant' | 'prisma' | 'lance';

/**
 * Callback for unit drag operations
 */
export interface UnitDragCallbacks {
  onDragStart: (unitType: UnitType) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onDragCancel: () => void;
}

/**
 * UIManager - Handles all UI interactions and updates
 *
 * Responsible for:
 * - Notifications (show/hide)
 * - Resource display updates
 * - Unit button states
 * - Wave timer display
 * - Exit/beforeunload handling
 * - Territory indicator
 * - Pause/resume UI with pause counter
 *
 * Note: UIManager is decoupled from game systems.
 * It receives UI data via EventBus events.
 */
export class UIManager {
  private eventBus: EventBus;
  private localPlayerId: string;

  // Cached UI state from events
  private cachedResources: UIResourcesUpdatedEvent | null = null;
  private cachedFormation: UIFormationUpdatedEvent | null = null;

  // Callbacks
  private onExitCallback: (() => void) | null = null;
  private beforeUnloadHandler:
    | ((e: BeforeUnloadEvent) => string | undefined)
    | null = null;
  private notificationTimeout: number | null = null;

  // Touch drag state for unit placement
  private dragCallbacks: UnitDragCallbacks | null = null;
  private activeDragUnitType: UnitType | null = null;
  private isDragging: boolean = false;

  // Pause tracking
  private pausesUsed: number = 0;
  private pausedByPlayerId: string | null = null;

  // Unsubscribe functions for event listeners
  private unsubscribers: (() => void)[] = [];

  constructor(
    eventBus: EventBus,
    localPlayerId: string
  ) {
    this.eventBus = eventBus;
    this.localPlayerId = localPlayerId;

    this.setupEventListeners();
  }

  /**
   * Setup event listeners for UI updates
   */
  private setupEventListeners(): void {
    // Listen for resource updates
    this.unsubscribers.push(
      this.eventBus.on<UIResourcesUpdatedEvent>(
        GameEvents.UI_RESOURCES_UPDATED,
        (event) => {
          if (event.playerId === this.localPlayerId) {
            this.cachedResources = event;
            this.renderResourceUI();
          }
        }
      )
    );

    // Listen for formation updates
    this.unsubscribers.push(
      this.eventBus.on<UIFormationUpdatedEvent>(
        GameEvents.UI_FORMATION_UPDATED,
        (event) => {
          if (event.playerId === this.localPlayerId) {
            this.cachedFormation = event;
            this.renderFormationInfo();
          }
        }
      )
    );
  }

  /**
   * Set exit callback
   */
  public setOnExit(callback: () => void): void {
    this.onExitCallback = callback;
  }

  /**
   * Trigger exit callback
   */
  public triggerExit(): void {
    this.onExitCallback?.();
  }

  /**
   * Setup exit button handler
   */
  public setupExitButton(handleExit: () => void): void {
    const exitBtn = document.getElementById('exit-btn');
    if (exitBtn) {
      exitBtn.addEventListener('click', () => {
        handleExit();
      });
    }
  }

  /**
   * Setup "Switch To Base" button handler
   */
  public setupBaseButton(onBaseClick: () => void): void {
    const baseBtn = document.getElementById('base-btn');
    if (baseBtn) {
      baseBtn.addEventListener('click', () => {
        onBaseClick();
      });
      this.addTouchFeedback(baseBtn);
    }
  }

  /**
   * Setup pause button and resume button handlers.
   * Clicking the Pause button fires onPause (which should send a request to the server).
   * Clicking the Resume button fires onResume (also a server request).
   * Neither handler freezes the game locally — the freeze happens when the
   * server broadcasts the pause/resume event back to all clients.
   */
  public setupPauseButton(onPause: () => void, onResume: () => void): void {
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');

    // Initialize pause counter display
    this.updatePauseButtonText();

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        onPause();
      });
    }

    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        onResume();
      });
    }
  }

  /**
   * Update pause button text to show remaining pauses
   */
  private updatePauseButtonText(): void {
    const pauseBtn = document.getElementById('pause-btn');
    if (!pauseBtn) return;

    const remaining = this.getRemainingPauses();
    if (remaining === Infinity) {
      pauseBtn.textContent = '⏸ Pause';
    } else if (remaining > 0) {
      pauseBtn.textContent = `⏸ Pause (${remaining})`;
    } else {
      pauseBtn.textContent = '⏸ No Pauses Left';
      pauseBtn.setAttribute('disabled', 'true');
    }
  }

  /**
   * Get remaining pauses for the local player
   */
  public getRemainingPauses(): number {
    if (pauseConfig.maxPausesPerPlayer === Infinity) {
      return Infinity;
    }
    return Math.max(0, pauseConfig.maxPausesPerPlayer - this.pausesUsed);
  }

  /**
   * Check if local player can pause the game
   */
  public canPause(): boolean {
    return this.getRemainingPauses() > 0;
  }

  /**
   * Get the player ID who initiated the current pause (if any)
   */
  public getPausedByPlayerId(): string | null {
    return this.pausedByPlayerId;
  }

  /**
   * Show the pause overlay and hide the pause button
   * @param pausedByPlayerId - Player ID who paused the game
   */
  public showPauseOverlay(pausedByPlayerId?: string): void {
    const overlay = document.getElementById('pause-overlay');
    const pauseBtn = document.getElementById('pause-btn');
    const pauseLabel = document.getElementById('pause-label');
    const resumeBtn = document.getElementById('resume-btn');

    // Track who paused
    this.pausedByPlayerId = pausedByPlayerId ?? null;

    // If local player paused, increment their counter
    if (pausedByPlayerId === this.localPlayerId) {
      this.pausesUsed++;
      this.updatePauseButtonText();
    }

    // Update pause label
    if (pauseLabel) {
      if (pausedByPlayerId === this.localPlayerId) {
        pauseLabel.textContent = 'Game Paused (by you)';
      } else if (pausedByPlayerId) {
        pauseLabel.textContent = `Game Paused (by opponent)`;
      } else {
        pauseLabel.textContent = 'Game Paused';
      }
    }

    // Update resume button based on requireSamePlayerToResume
    if (resumeBtn) {
      const canResume = !pauseConfig.requireSamePlayerToResume ||
        pausedByPlayerId === this.localPlayerId;

      if (canResume) {
        resumeBtn.removeAttribute('disabled');
        resumeBtn.textContent = 'Resume Game';
      } else {
        resumeBtn.setAttribute('disabled', 'true');
        resumeBtn.textContent = 'Waiting for opponent to resume...';
      }
    }

    if (overlay) overlay.classList.add('visible');
    if (pauseBtn) pauseBtn.style.display = 'none';
  }

  /**
   * Hide the pause overlay and show the pause button
   */
  public hidePauseOverlay(): void {
    const overlay = document.getElementById('pause-overlay');
    const pauseBtn = document.getElementById('pause-btn');

    // Clear pause state
    this.pausedByPlayerId = null;

    if (overlay) overlay.classList.remove('visible');

    // Only show pause button if player has pauses remaining
    if (pauseBtn) {
      if (this.canPause()) {
        pauseBtn.style.display = '';
        pauseBtn.removeAttribute('disabled');
      } else {
        pauseBtn.style.display = '';
        pauseBtn.setAttribute('disabled', 'true');
      }
    }
  }

  /**
   * Setup warning when user tries to reload/close the page during game
   */
  public setupBeforeUnloadWarning(): void {
    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      const message = 'You will be kicked out of the game!';
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  /**
   * Remove beforeunload warning (when exiting properly)
   */
  public removeBeforeUnloadWarning(): void {
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  }

  /**
   * Show a notification message
   */
  public showNotification(
    message: string,
    type: 'info' | 'warning' = 'info'
  ): void {
    const notification = document.getElementById('notification');
    if (!notification) return;

    // Clear existing timeout
    if (this.notificationTimeout !== null) {
      clearTimeout(this.notificationTimeout);
    }

    notification.textContent = message;
    notification.className = `show ${type}`;

    // Auto-hide after 3 seconds
    this.notificationTimeout = window.setTimeout(() => {
      this.hideNotification();
    }, 3000);
  }

  /**
   * Hide the notification
   */
  public hideNotification(): void {
    const notification = document.getElementById('notification');
    if (notification) {
      notification.className = '';
    }
    this.notificationTimeout = null;
  }

  /**
   * Update player info UI
   */
  public updatePlayerInfoUI(teamColor: string, username: string): void {
    const colorIndicator = document.getElementById('player-color-indicator');
    const playerName = document.getElementById('player-name');

    if (colorIndicator) {
      colorIndicator.style.backgroundColor = teamColor;
    }

    if (playerName) {
      playerName.textContent = `You: ${username}`;
    }
  }

  /**
   * Reset territory indicator to hidden state
   */
  public resetTerritoryIndicator(): void {
    const indicator = document.getElementById('territory-indicator');
    if (indicator) {
      indicator.classList.remove('active');
    }
  }

  /**
   * Show territory indicator
   */
  public showTerritoryIndicator(): void {
    const indicator = document.getElementById('territory-indicator');
    if (indicator) {
      indicator.classList.add('active');
    }
  }

  /**
   * Hide territory indicator
   */
  public hideTerritoryIndicator(): void {
    const indicator = document.getElementById('territory-indicator');
    if (indicator) {
      indicator.classList.remove('active');
    }
  }

  /**
   * Render the resource UI from cached event data
   */
  private renderResourceUI(): void {
    if (!this.cachedResources) return;

    const amountEl = document.getElementById('resource-amount');
    const rateEl = document.getElementById('resource-rate');

    if (amountEl) {
      amountEl.textContent = Math.floor(this.cachedResources.currentResources).toString();
    }

    if (rateEl) {
      rateEl.textContent = `(+${this.cachedResources.currentGenerationRate.toFixed(1)}/s)`;
      if (this.cachedResources.hasAggressionBonus) {
        rateEl.classList.add('bonus');
      } else {
        rateEl.classList.remove('bonus');
      }
    }

    // Update button states based on affordability
    this.renderUnitButtonStates();
  }

  /**
   * Render unit button states from cached event data
   */
  private renderUnitButtonStates(): void {
    if (!this.cachedResources) return;

    const mutantBtn = document.getElementById('mutant-btn');
    const prismaBtn = document.getElementById('prisma-btn');
    const lanceBtn = document.getElementById('lance-btn');

    if (mutantBtn) {
      if (this.cachedResources.canAffordMutant) {
        mutantBtn.classList.remove('disabled');
      } else {
        mutantBtn.classList.add('disabled');
      }
    }

    if (prismaBtn) {
      if (this.cachedResources.canAffordPrisma) {
        prismaBtn.classList.remove('disabled');
      } else {
        prismaBtn.classList.add('disabled');
      }
    }

    if (lanceBtn) {
      if (this.cachedResources.canAffordLance) {
        lanceBtn.classList.remove('disabled');
      } else {
        lanceBtn.classList.add('disabled');
      }
    }
  }

  /**
   * Update wave timer display
   */
  public updateWaveTimer(
    waveNumber: number,
    secondsRemaining: number,
    isPreparationWave: boolean
  ): void {
    const waveLabel = document.getElementById('wave-label');
    const waveTimer = document.getElementById('wave-timer');
    const waveContainer = document.getElementById('wave-container');

    if (waveLabel) {
      if (isPreparationWave) {
        waveLabel.textContent = 'Preparation';
      } else {
        waveLabel.textContent = `Wave ${waveNumber}`;
      }
    }

    if (waveTimer) {
      waveTimer.textContent = `${secondsRemaining}s`;

      // Add warning class when time is low
      if (secondsRemaining <= 5) {
        waveTimer.classList.add('warning');
      } else {
        waveTimer.classList.remove('warning');
      }
    }

    if (waveContainer) {
      if (isPreparationWave) {
        waveContainer.classList.add('preparation');
      } else {
        waveContainer.classList.remove('preparation');
      }
    }
  }

  /**
   * Render formation info from cached event data
   */
  private renderFormationInfo(): void {
    if (!this.cachedFormation) return;

    const formationInfo = document.getElementById('formation-info');
    if (formationInfo) {
      formationInfo.textContent = `Units in formation: ${this.cachedFormation.placedUnitCount}`;
    }
  }

  /**
   * Set active unit button
   * Accepts any FormationUnitType but only highlights known unit buttons
   */
  public setActiveUnitButton(unitType: string | null): void {
    const mutantBtn = document.getElementById('mutant-btn');
    const prismaBtn = document.getElementById('prisma-btn');
    const lanceBtn = document.getElementById('lance-btn');

    // Remove active class from all buttons
    mutantBtn?.classList.remove('active');
    prismaBtn?.classList.remove('active');
    lanceBtn?.classList.remove('active');

    // Add active class to specified button
    if (unitType === 'mutant') {
      mutantBtn?.classList.add('active');
    } else if (unitType === 'prisma') {
      prismaBtn?.classList.add('active');
    } else if (unitType === 'lance') {
      lanceBtn?.classList.add('active');
    }
  }

  /**
   * Setup unit placement button handlers
   * Note: Deployment is now automatic via wave system, no commit button needed
   *
   * Desktop: Click to enter placement mode, click on grid to place
   * Mobile: Touch and drag from button to grid, release to place
   */
  public setupUnitPlacementButtons(
    onMutantClick: () => void,
    onPrismaClick: () => void,
    onLanceClick: () => void
  ): void {
    const mutantBtn = document.getElementById('mutant-btn');
    const prismaBtn = document.getElementById('prisma-btn');
    const lanceBtn = document.getElementById('lance-btn');

    // Desktop: click handlers
    mutantBtn?.addEventListener('click', onMutantClick);
    prismaBtn?.addEventListener('click', onPrismaClick);
    lanceBtn?.addEventListener('click', onLanceClick);

    // Mobile: touch drag handlers
    this.setupButtonTouchDrag(mutantBtn, 'mutant');
    this.setupButtonTouchDrag(prismaBtn, 'prisma');
    this.setupButtonTouchDrag(lanceBtn, 'lance');

    // Also add touch feedback to exit button
    const exitBtn = document.getElementById('exit-btn');
    this.addTouchFeedback(exitBtn);
  }

  /**
   * Set callbacks for unit drag operations
   */
  public setDragCallbacks(callbacks: UnitDragCallbacks): void {
    this.dragCallbacks = callbacks;
  }

  /**
   * Setup touch drag handling for a unit button
   */
  private setupButtonTouchDrag(
    button: HTMLElement | null,
    unitType: UnitType
  ): void {
    if (!button) return;

    let dragStarted = false;

    button.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (e.touches.length !== 1) return;

        dragStarted = false;
        this.activeDragUnitType = unitType;

        // Visual feedback
        button.style.transform = 'scale(0.95)';
      },
      { passive: true }
    );

    button.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (e.touches.length !== 1 || !this.activeDragUnitType) return;

        const touch = e.touches[0];

        // Start drag on first move
        if (!dragStarted) {
          dragStarted = true;
          this.isDragging = true;
          this.dragCallbacks?.onDragStart(this.activeDragUnitType);
        }

        // Notify drag move
        this.dragCallbacks?.onDragMove(touch.clientX, touch.clientY);
      },
      { passive: true }
    );

    button.addEventListener('touchend', (e: TouchEvent) => {
      button.style.transform = '';

      if (this.isDragging && this.activeDragUnitType) {
        // Get the last touch position from changedTouches
        const touch = e.changedTouches[0];
        if (touch) {
          this.dragCallbacks?.onDragEnd(touch.clientX, touch.clientY);
        } else {
          this.dragCallbacks?.onDragCancel();
        }
      }

      this.isDragging = false;
      this.activeDragUnitType = null;
    });

    button.addEventListener('touchcancel', () => {
      button.style.transform = '';

      if (this.isDragging) {
        this.dragCallbacks?.onDragCancel();
      }

      this.isDragging = false;
      this.activeDragUnitType = null;
    });
  }

  /**
   * Add touch feedback to a button element for better mobile UX
   */
  private addTouchFeedback(element: HTMLElement | null): void {
    if (!element) return;

    element.addEventListener('touchstart', () => {
      element.style.transform = 'scale(0.95)';
    });

    element.addEventListener('touchend', () => {
      element.style.transform = '';
    });

    element.addEventListener('touchcancel', () => {
      element.style.transform = '';
    });
  }

  /**
   * Cleanup
   */
  public dispose(): void {
    // Unsubscribe from all events
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];

    this.removeBeforeUnloadWarning();
    if (this.notificationTimeout !== null) {
      clearTimeout(this.notificationTimeout);
    }
  }
}
