import {
  Scene,
  FreeCamera,
  Vector3,
  KeyboardEventTypes,
} from '@babylonjs/core';
import { cameraConfig, arenaParams } from '../config/constants';
import { TeamTag } from '../enums/TeamTag';

/**
 * CameraController - RTS-style top-down camera with arrow key movement and touch support
 * Each player has their own camera controller that starts over their base
 *
 * Camera is rotated so each player sees their formation at the bottom of the screen
 * with units moving "upward" toward the enemy:
 * - Team1 (left side): Camera looks toward +X
 * - Team2 (right side): Camera looks toward -X
 */
export class CameraController {
  private scene: Scene;
  private camera: FreeCamera;
  private localTeam: TeamTag;

  // Movement state (keyboard)
  private moveUp: boolean = false;
  private moveDown: boolean = false;
  private moveLeft: boolean = false;
  private moveRight: boolean = false;

  // Touch movement state
  private isTouchDragging: boolean = false;
  private lastTouchX: number = 0;
  private lastTouchY: number = 0;
  private touchVelocityX: number = 0;
  private touchVelocityZ: number = 0;
  private readonly touchSensitivity: number = 0.15;
  private readonly inertiaDecay: number = 0.92;
  private readonly minInertia: number = 0.1;

  // Pinch-to-zoom state
  private isPinching: boolean = false;
  private lastPinchDistance: number = 0;

  // Drag mode - camera movement disabled when dragging units
  private isDragModeActive: boolean = false;

  // Camera bounds (to prevent going out of arena)
  private minX: number;
  private maxX: number;
  private minZ: number;
  private maxZ: number;

  // Touch event handlers (stored for cleanup)
  private touchStartHandler: ((e: TouchEvent) => void) | null = null;
  private touchMoveHandler: ((e: TouchEvent) => void) | null = null;
  private touchEndHandler: ((e: TouchEvent) => void) | null = null;

  constructor(scene: Scene, localTeam: TeamTag) {
    this.scene = scene;
    this.localTeam = localTeam;

    // Calculate camera bounds based on arena size
    // The camera needs to be able to move "behind" the formation grid to see it fully
    // This requires extending the bounds by the lookAheadOffset in the direction away from enemy
    const halfWidth = arenaParams.ground.width / 2;
    const halfHeight = arenaParams.ground.height / 2;

    // X bounds: extend beyond arena to allow camera to position behind formation grid
    // Add extra padding for the lookAheadOffset so player can see their full formation
    this.minX = -halfWidth - cameraConfig.lookAheadOffset;
    this.maxX = halfWidth + cameraConfig.lookAheadOffset;

    // Z bounds: standard arena bounds with padding
    this.minZ = -halfHeight + cameraConfig.boundsPadding;
    this.maxZ = halfHeight - cameraConfig.boundsPadding;

    // Create camera at starting position based on team
    this.camera = this.createCamera();

    // Setup keyboard controls
    this.setupKeyboardControls();

    // Setup touch controls for mobile
    this.setupTouchControls();

    // Note: Update loop is now driven externally via update(dt) calls
  }

  /**
   * Create the camera at the appropriate starting position for the team
   * Camera is rotated so each player sees their units moving "bottom to top" toward the enemy
   */
  private createCamera(): FreeCamera {
    // Get team configuration
    const teamConfig =
      this.localTeam === TeamTag.Team1 ? arenaParams.teamA : arenaParams.teamB;

    // Direction toward enemy: +1 for Team1 (toward +X), -1 for Team2 (toward -X)
    const towardEnemy = this.localTeam === TeamTag.Team1 ? 1 : -1;

    // Camera is positioned behind the formation grid, looking toward the enemy
    // The lookAheadOffset is applied in the direction away from the enemy (behind the player)
    const cameraX =
      teamConfig.formationGridCenter.x -
      towardEnemy * cameraConfig.lookAheadOffset;
    const cameraZ = 0;

    // Target is in front of the camera (toward enemy)
    const targetX =
      teamConfig.formationGridCenter.x +
      towardEnemy * cameraConfig.lookAheadOffset * 0.5;
    const targetZ = 0;

    // Create camera at height looking down at an angle
    const camera = new FreeCamera(
      'rtsCamera',
      new Vector3(cameraX, cameraConfig.height, cameraZ),
      this.scene
    );

    // Set target to look toward enemy territory
    camera.setTarget(new Vector3(targetX, 0, targetZ));

    // Lock camera rotation - RTS cameras don't rotate from user input
    camera.angularSensibility = 0;

    // Disable default keyboard inputs (we'll handle our own)
    camera.inputs.clear();

    return camera;
  }

  /**
   * Setup keyboard event listeners for arrow key movement
   */
  private setupKeyboardControls(): void {
    this.scene.onKeyboardObservable.add((kbInfo) => {
      const pressed = kbInfo.type === KeyboardEventTypes.KEYDOWN;

      switch (kbInfo.event.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
          this.moveUp = pressed;
          kbInfo.event.preventDefault();
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          this.moveDown = pressed;
          kbInfo.event.preventDefault();
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          this.moveLeft = pressed;
          kbInfo.event.preventDefault();
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          this.moveRight = pressed;
          kbInfo.event.preventDefault();
          break;
      }
    });
  }

  /**
   * Setup touch event listeners for mobile camera panning
   * Uses two-finger detection to avoid conflicting with unit placement
   */
  private setupTouchControls(): void {
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) return;

    this.touchStartHandler = (e: TouchEvent) => {
      // Skip camera touch handling when in drag mode (dragging units)
      if (this.isDragModeActive) return;

      // Two fingers = pinch-to-zoom
      if (e.touches.length === 2) {
        this.isPinching = true;
        this.isTouchDragging = false;
        this.lastPinchDistance = this.getPinchDistance(
          e.touches[0],
          e.touches[1]
        );
        // Stop inertia when starting pinch
        this.touchVelocityX = 0;
        this.touchVelocityZ = 0;
      }
      // Only start camera pan with single finger
      else if (e.touches.length === 1 && !this.isPinching) {
        const touch = e.touches[0];
        this.lastTouchX = touch.clientX;
        this.lastTouchY = touch.clientY;
        this.isTouchDragging = true;
        // Stop inertia when starting new touch
        this.touchVelocityX = 0;
        this.touchVelocityZ = 0;
      }
    };

    this.touchMoveHandler = (e: TouchEvent) => {
      // Skip camera touch handling when in drag mode (dragging units)
      if (this.isDragModeActive) return;

      // Handle pinch-to-zoom - also detect if we transition to 2 fingers during move
      if (e.touches.length === 2) {
        // If we weren't pinching before, start now
        if (!this.isPinching) {
          this.isPinching = true;
          this.isTouchDragging = false;
          this.lastPinchDistance = this.getPinchDistance(
            e.touches[0],
            e.touches[1]
          );
          return;
        }
        const currentDistance = this.getPinchDistance(
          e.touches[0],
          e.touches[1]
        );
        const deltaDistance = currentDistance - this.lastPinchDistance;
        this.applyPinchZoom(deltaDistance);
        this.lastPinchDistance = currentDistance;
        return;
      }

      if (!this.isTouchDragging || e.touches.length !== 1) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - this.lastTouchX;
      const deltaY = touch.clientY - this.lastTouchY;

      // Store velocity for inertia (smoothed)
      this.touchVelocityX = deltaX * this.touchSensitivity;
      this.touchVelocityZ = deltaY * this.touchSensitivity;

      // Update last position
      this.lastTouchX = touch.clientX;
      this.lastTouchY = touch.clientY;

      // Apply immediate movement (inverted for natural drag feel)
      this.applyTouchMovement(-this.touchVelocityX, this.touchVelocityZ);
    };

    this.touchEndHandler = (e: TouchEvent) => {
      // If we were pinching and now have fewer than 2 fingers, stop pinching
      if (this.isPinching && e.touches.length < 2) {
        this.isPinching = false;
        // If one finger remains, start panning from that position
        if (e.touches.length === 1) {
          const touch = e.touches[0];
          this.lastTouchX = touch.clientX;
          this.lastTouchY = touch.clientY;
          this.isTouchDragging = true;
        }
      }

      if (e.touches.length === 0) {
        this.isTouchDragging = false;
        // Invert X velocity for drag direction, Z stays the same
        this.touchVelocityX = -this.touchVelocityX;
        // touchVelocityZ already has correct sign from touchMove
      }
    };

    canvas.addEventListener('touchstart', this.touchStartHandler, {
      passive: true,
    });
    canvas.addEventListener('touchmove', this.touchMoveHandler, {
      passive: true,
    });
    canvas.addEventListener('touchend', this.touchEndHandler, {
      passive: true,
    });
    canvas.addEventListener('touchcancel', this.touchEndHandler, {
      passive: true,
    });
  }

  /**
   * Apply touch movement to camera position
   * screenDeltaX/screenDeltaZ are screen-relative (deltaX = horizontal, deltaZ = vertical)
   */
  private applyTouchMovement(screenDeltaX: number, screenDeltaZ: number): void {
    // Transform screen-relative movement to world-space based on team
    // Team1: looking toward +X, so "up" on screen = +X, "right" on screen = -Z
    // Team2: looking toward -X, so "up" on screen = -X, "right" on screen = +Z
    const towardEnemy = this.localTeam === TeamTag.Team1 ? 1 : -1;

    // screenDeltaZ (up/down on screen) → movement along X axis (toward/away from enemy)
    // screenDeltaX (left/right on screen) → movement along Z axis (inverted relative to towardEnemy)
    const worldDeltaX = screenDeltaZ * towardEnemy;
    const worldDeltaZ = -screenDeltaX * towardEnemy;

    const newPosition = this.camera.position.clone();
    newPosition.x += worldDeltaX;
    newPosition.z += worldDeltaZ;

    // Clamp to bounds
    newPosition.x = Math.max(this.minX, Math.min(this.maxX, newPosition.x));
    newPosition.z = Math.max(this.minZ, Math.min(this.maxZ, newPosition.z));

    // Update camera position
    this.camera.position = newPosition;

    // Update target to maintain look direction
    const targetPosition = new Vector3(
      newPosition.x + towardEnemy * cameraConfig.lookAheadOffset,
      0,
      newPosition.z
    );
    this.camera.setTarget(targetPosition);
  }

  /**
   * Calculate the distance between two touch points
   */
  private getPinchDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Apply pinch zoom by adjusting camera height
   * Positive delta = fingers moving apart = zoom in (lower height)
   * Negative delta = fingers moving together = zoom out (higher height)
   */
  private applyPinchZoom(deltaDistance: number): void {
    // Invert: spreading fingers should zoom in (decrease height)
    const heightDelta = -deltaDistance * cameraConfig.zoomSensitivity;

    let newHeight = this.camera.position.y + heightDelta;

    // Clamp to height bounds
    newHeight = Math.max(
      cameraConfig.minHeight,
      Math.min(cameraConfig.maxHeight, newHeight)
    );

    // Update camera position with new height
    this.camera.position.y = newHeight;
  }

  /**
   * Update camera position based on input
   * Should be called each frame with the delta time in seconds
   */
  public update(dt: number): void {
    const moveSpeed = cameraConfig.moveSpeed * dt;

    // Screen-relative movement (before rotation)
    let screenDeltaX = 0; // Left/Right on screen
    let screenDeltaY = 0; // Up/Down on screen (toward/away from enemy)

    // Calculate movement direction from keyboard (screen-relative)
    if (this.moveUp) screenDeltaY += moveSpeed; // W/Up = toward enemy (up on screen)
    if (this.moveDown) screenDeltaY -= moveSpeed; // S/Down = away from enemy (down on screen)
    if (this.moveLeft) screenDeltaX -= moveSpeed; // A/Left = left on screen
    if (this.moveRight) screenDeltaX += moveSpeed; // D/Right = right on screen

    // Normalize diagonal movement
    if (screenDeltaX !== 0 && screenDeltaY !== 0) {
      const normalize = 1 / Math.sqrt(2);
      screenDeltaX *= normalize;
      screenDeltaY *= normalize;
    }

    // Apply keyboard movement if any
    if (screenDeltaX !== 0 || screenDeltaY !== 0) {
      // Transform screen-relative movement to world-space based on team
      // Team1: looking toward +X, so "up" on screen = +X, "right" on screen = -Z
      // Team2: looking toward -X, so "up" on screen = -X, "right" on screen = +Z
      const towardEnemy = this.localTeam === TeamTag.Team1 ? 1 : -1;

      // screenDeltaY (up/down on screen) → movement along X axis (toward/away from enemy)
      // screenDeltaX (left/right on screen) → movement along Z axis (inverted relative to towardEnemy)
      const worldDeltaX = screenDeltaY * towardEnemy;
      const worldDeltaZ = -screenDeltaX * towardEnemy;

      const newPosition = this.camera.position.clone();
      newPosition.x += worldDeltaX;
      newPosition.z += worldDeltaZ;

      // Clamp to bounds
      newPosition.x = Math.max(this.minX, Math.min(this.maxX, newPosition.x));
      newPosition.z = Math.max(this.minZ, Math.min(this.maxZ, newPosition.z));

      // Update camera position
      this.camera.position = newPosition;

      // Update target to maintain look direction
      const targetPosition = new Vector3(
        newPosition.x + towardEnemy * cameraConfig.lookAheadOffset,
        0,
        newPosition.z
      );
      this.camera.setTarget(targetPosition);
    }

    // Apply touch inertia when not actively dragging
    if (
      !this.isTouchDragging &&
      (Math.abs(this.touchVelocityX) > this.minInertia ||
        Math.abs(this.touchVelocityZ) > this.minInertia)
    ) {
      this.applyTouchMovement(this.touchVelocityX, this.touchVelocityZ);

      // Decay the velocity
      this.touchVelocityX *= this.inertiaDecay;
      this.touchVelocityZ *= this.inertiaDecay;

      // Stop if velocity is too small
      if (Math.abs(this.touchVelocityX) < this.minInertia)
        this.touchVelocityX = 0;
      if (Math.abs(this.touchVelocityZ) < this.minInertia)
        this.touchVelocityZ = 0;
    }
  }

  /**
   * Get the camera instance
   */
  public getCamera(): FreeCamera {
    return this.camera;
  }

  /**
   * Move camera to focus on a specific position
   */
  public focusOn(position: Vector3): void {
    const towardEnemy = this.localTeam === TeamTag.Team1 ? 1 : -1;

    // Position camera behind the target (away from enemy)
    const newPosition = new Vector3(
      position.x - towardEnemy * cameraConfig.lookAheadOffset,
      cameraConfig.height,
      position.z
    );

    // Clamp to bounds
    newPosition.x = Math.max(this.minX, Math.min(this.maxX, newPosition.x));
    newPosition.z = Math.max(this.minZ, Math.min(this.maxZ, newPosition.z));

    this.camera.position = newPosition;

    // Look toward enemy
    this.camera.setTarget(
      new Vector3(
        position.x + towardEnemy * cameraConfig.lookAheadOffset * 0.5,
        0,
        position.z
      )
    );
  }

  /**
   * Enable drag mode - disables camera touch movement
   * Used when dragging units from buttons to the formation grid
   */
  public enableDragMode(): void {
    this.isDragModeActive = true;
    this.isTouchDragging = false;
    this.isPinching = false;
    this.touchVelocityX = 0;
    this.touchVelocityZ = 0;
  }

  /**
   * Disable drag mode - re-enables camera touch movement
   */
  public disableDragMode(): void {
    this.isDragModeActive = false;
  }

  /**
   * Check if drag mode is active
   */
  public isDragMode(): boolean {
    return this.isDragModeActive;
  }

  /**
   * Focus camera on the formation grid and adjust height to fit it in view
   * Called at game start to ensure the player can see their entire formation area
   */
  public focusOnFormationGrid(): void {
    const gridConfig = arenaParams.formationGrid;
    const teamConfig =
      this.localTeam === TeamTag.Team1 ? arenaParams.teamA : arenaParams.teamB;

    // Target position: center of formation grid
    const targetX = teamConfig.formationGridCenter.x;
    const targetZ = teamConfig.formationGridCenter.z;

    // Calculate height needed to fit grid in view
    // Grid dimensions: width (along Z after rotation) and height (along X after rotation)
    // After 90° rotation: grid height (80 units along X) becomes vertical on screen
    //                     grid width (40 units along Z) becomes horizontal on screen
    const gridHeight = gridConfig.height; // 80 units - this is vertical on screen
    const gridWidth = gridConfig.width; // 40 units - this is horizontal on screen

    // Use camera FOV and aspect ratio to calculate required height
    const fov = this.camera.fov; // Default ~0.8 radians (~45°)
    const aspectRatio = this.scene.getEngine().getAspectRatio(this.camera);

    // Calculate height based on vertical FOV to fit the grid height
    // height = (size/2) / tan(fov/2) gives the distance needed to see the size
    const heightForVertical = gridHeight / 2 / Math.tan(fov / 2);

    // Calculate height for horizontal dimension (accounts for aspect ratio)
    const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * aspectRatio);
    const heightForHorizontal = gridWidth / 2 / Math.tan(horizontalFov / 2);

    // Use the larger height requirement with padding (1.3 = 30% padding)
    const paddingMultiplier = 1.3;
    let requiredHeight =
      Math.max(heightForVertical, heightForHorizontal) * paddingMultiplier;

    // Clamp to allowed bounds
    requiredHeight = Math.max(
      cameraConfig.minHeight,
      Math.min(cameraConfig.maxHeight, requiredHeight)
    );

    // Direction toward enemy
    const towardEnemy = this.localTeam === TeamTag.Team1 ? 1 : -1;

    // Position camera behind the formation grid center (away from enemy)
    const cameraX = targetX - towardEnemy * cameraConfig.lookAheadOffset * 0.5;

    this.camera.position = new Vector3(cameraX, requiredHeight, targetZ);
    this.camera.setTarget(new Vector3(targetX, 0, targetZ));
  }

  /**
   * Dispose of the camera controller
   */
  public dispose(): void {
    // Remove touch event listeners
    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (canvas) {
      if (this.touchStartHandler) {
        canvas.removeEventListener('touchstart', this.touchStartHandler);
      }
      if (this.touchMoveHandler) {
        canvas.removeEventListener('touchmove', this.touchMoveHandler);
      }
      if (this.touchEndHandler) {
        canvas.removeEventListener('touchend', this.touchEndHandler);
        canvas.removeEventListener('touchcancel', this.touchEndHandler);
      }
    }

    // Observable cleanup is handled automatically when scene is disposed
    this.camera.dispose();
  }
}
