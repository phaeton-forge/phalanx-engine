import * as THREE from 'three';
import { arenaParams, cameraConfig } from '../config/constants';

export class CameraController {
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  private readonly cameraAnchor = new THREE.Vector3();
  private readonly pressedKeys = new Set<string>();
  private readonly forwardZ: 1 | -1;
  private cameraHeight = cameraConfig.height;

  /** When true, one-finger pan / pinch zoom ignore touch input (e.g. unit drag). */
  private touchPanBlocked = false;
  private activePanTouchId: number | null = null;
  private pinchActive = false;
  private pinchStartDistance = 0;
  private pinchStartHeight = 0;

  private readonly raycaster = new THREE.Raycaster();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly lastGroundPoint = new THREE.Vector3();
  private readonly groundHit = new THREE.Vector3();
  private canvas: HTMLCanvasElement | null = null;

  constructor(localTeamId: 0 | 1) {
    this.forwardZ = localTeamId === 0 ? 1 : -1;
    this.cameraAnchor.set(
      0,
      0,
      localTeamId === 0 ? arenaParams.team1SpawnZ : arenaParams.team2SpawnZ
    );
    this.syncToAnchor();
  }

  /**
   * Suppress touch pan/pinch while another gesture owns the pointer
   * (formation unit drag). Clears any in-flight touch camera gesture.
   */
  setTouchPanBlocked(blocked: boolean): void {
    this.touchPanBlocked = blocked;
    if (blocked) {
      this.clearTouchGesture();
    }
  }

  update(dt: number): void {
    const safeDt = Math.min(Math.max(dt || 0, 1 / 120), 1 / 15);
    let screenRight = 0;
    let screenForward = 0;
    if (this.pressedKeys.has('arrowup') || this.pressedKeys.has('w'))
      screenForward += 1;
    if (this.pressedKeys.has('arrowdown') || this.pressedKeys.has('s'))
      screenForward -= 1;
    if (this.pressedKeys.has('arrowright') || this.pressedKeys.has('d'))
      screenRight += 1;
    if (this.pressedKeys.has('arrowleft') || this.pressedKeys.has('a'))
      screenRight -= 1;
    if (screenRight === 0 && screenForward === 0) return;
    const length = Math.hypot(screenRight, screenForward);
    if (length > 1) {
      screenRight /= length;
      screenForward /= length;
    }
    const distance = cameraConfig.moveSpeed * safeDt;
    this.cameraAnchor.x -= screenRight * this.forwardZ * distance;
    this.cameraAnchor.z += screenForward * this.forwardZ * distance;
    this.clampAnchor();
    this.syncToAnchor();
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  addListeners(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('touchstart', this.onTouchStart, {
      passive: false,
    });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.onTouchEnd);
    canvas.addEventListener('touchcancel', this.onTouchEnd);
  }

  removeListeners(canvas: HTMLCanvasElement): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('touchstart', this.onTouchStart);
    canvas.removeEventListener('touchmove', this.onTouchMove);
    canvas.removeEventListener('touchend', this.onTouchEnd);
    canvas.removeEventListener('touchcancel', this.onTouchEnd);
    this.clearTouchGesture();
    this.canvas = null;
  }

  private syncToAnchor(): void {
    const cameraZ =
      this.cameraAnchor.z - this.forwardZ * cameraConfig.lookAheadOffset;
    this.camera.position.set(this.cameraAnchor.x, this.cameraHeight, cameraZ);
    this.camera.lookAt(this.cameraAnchor.x, 0, this.cameraAnchor.z);
    this.camera.updateMatrixWorld(true);
  }

  private clampAnchor(): void {
    const halfWidth = arenaParams.width / 2 + cameraConfig.boundsPadding;
    const halfLength = arenaParams.length / 2 + cameraConfig.boundsPadding;
    this.cameraAnchor.x = THREE.MathUtils.clamp(
      this.cameraAnchor.x,
      -halfWidth,
      halfWidth
    );
    this.cameraAnchor.z = THREE.MathUtils.clamp(
      this.cameraAnchor.z,
      -halfLength,
      halfLength
    );
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (this.isCameraKey(key)) {
      event.preventDefault();
      this.pressedKeys.add(key);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.key.toLowerCase());
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.cameraHeight = THREE.MathUtils.clamp(
      this.cameraHeight + event.deltaY * cameraConfig.zoomSensitivity,
      cameraConfig.minHeight,
      cameraConfig.maxHeight
    );
    this.syncToAnchor();
  };

  private readonly onTouchStart = (event: TouchEvent): void => {
    if (this.touchPanBlocked) return;

    if (event.touches.length >= 2) {
      const a = event.touches[0];
      const b = event.touches[1];
      if (!a || !b) return;
      event.preventDefault();
      this.activePanTouchId = null;
      this.pinchActive = true;
      this.pinchStartDistance = this.touchDistance(a, b);
      this.pinchStartHeight = this.cameraHeight;
      return;
    }

    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (!touch || !this.canvas) return;
    if (
      !this.clientToGround(
        touch.clientX,
        touch.clientY,
        this.canvas,
        this.lastGroundPoint
      )
    ) {
      return;
    }
    this.pinchActive = false;
    this.activePanTouchId = touch.identifier;
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    if (this.touchPanBlocked || !this.canvas) return;

    if (this.pinchActive && event.touches.length >= 2) {
      const a = event.touches[0];
      const b = event.touches[1];
      if (!a || !b || this.pinchStartDistance <= 0) return;
      event.preventDefault();
      const distance = this.touchDistance(a, b);
      if (distance <= 0) return;
      // Fingers apart → zoom in (lower camera); fingers together → zoom out.
      const scale = this.pinchStartDistance / distance;
      this.cameraHeight = THREE.MathUtils.clamp(
        cameraConfig.minHeight,
        cameraConfig.maxHeight
      );
      this.syncToAnchor();
      return;
    }

    if (this.activePanTouchId === null) return;
    const touch = this.findTouch(event.touches, this.activePanTouchId);
    if (!touch) return;
    event.preventDefault();

    if (
      !this.clientToGround(
        touch.clientX,
        touch.clientY,
        this.canvas,
        this.groundHit
      )
    ) {
      return;
    }

    this.cameraAnchor.x += this.lastGroundPoint.x - this.groundHit.x;
    this.cameraAnchor.z += this.lastGroundPoint.z - this.groundHit.z;
    this.clampAnchor();
    this.syncToAnchor();

    // Re-project after the camera moved so the grab point stays under the finger.
    if (
      !this.clientToGround(
        touch.clientX,
        touch.clientY,
        this.canvas,
        this.lastGroundPoint
      )
    ) {
      this.lastGroundPoint.copy(this.groundHit);
    }
  };

  private readonly onTouchEnd = (event: TouchEvent): void => {
    if (event.touches.length === 0) {
      this.clearTouchGesture();
      return;
    }

    if (this.pinchActive && event.touches.length < 2) {
      this.pinchActive = false;
      this.pinchStartDistance = 0;
      // Resume one-finger pan with the remaining touch, if any.
      const remaining = event.touches[0];
      if (remaining && this.canvas && !this.touchPanBlocked) {
        if (
          this.clientToGround(
            remaining.clientX,
            remaining.clientY,
            this.canvas,
            this.lastGroundPoint
          )
        ) {
          this.activePanTouchId = remaining.identifier;
        }
      }
      return;
    }

    if (
      this.activePanTouchId !== null &&
      !this.findTouch(event.touches, this.activePanTouchId)
    ) {
      this.activePanTouchId = null;
    }
  };

  private clearTouchGesture(): void {
    this.activePanTouchId = null;
    this.pinchActive = false;
    this.pinchStartDistance = 0;
  }

  private clientToGround(
    clientX: number,
    clientY: number,
    canvas: HTMLCanvasElement,
    out: THREE.Vector3
  ): boolean {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    this.pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    // Touch handlers can run outside the render loop; keep the world matrix current
    // so setFromCamera projects against the latest camera pose.
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, out) !== null;
  }

  private touchDistance(a: Touch, b: Touch): number {
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  private findTouch(touches: TouchList, identifier: number): Touch | undefined {
    for (let i = 0; i < touches.length; i++) {
      const touch = touches.item(i);
      if (touch?.identifier === identifier) return touch;
    }
    return undefined;
  }

  private isCameraKey(key: string): boolean {
    return [
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright',
      'w',
      'a',
      's',
      'd',
    ].includes(key);
  }
}
