import * as THREE from 'three';
import { arenaParams, cameraConfig } from '../config/constants';

export class CameraController {
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  private readonly cameraAnchor = new THREE.Vector3();
  private readonly pressedKeys = new Set<string>();
  private readonly forwardZ: 1 | -1;
  private cameraHeight = cameraConfig.height;

  constructor(localTeamId: 0 | 1) {
    this.forwardZ = localTeamId === 0 ? 1 : -1;
    this.cameraAnchor.set(
      0,
      0,
      localTeamId === 0 ? arenaParams.team1SpawnZ : arenaParams.team2SpawnZ,
    );
    this.syncToAnchor();
  }

  update(dt: number): void {
    const safeDt = Math.min(Math.max(dt || 0, 1 / 120), 1 / 15);
    let screenRight = 0;
    let screenForward = 0;
    if (this.pressedKeys.has('arrowup') || this.pressedKeys.has('w')) screenForward += 1;
    if (this.pressedKeys.has('arrowdown') || this.pressedKeys.has('s')) screenForward -= 1;
    if (this.pressedKeys.has('arrowright') || this.pressedKeys.has('d')) screenRight += 1;
    if (this.pressedKeys.has('arrowleft') || this.pressedKeys.has('a')) screenRight -= 1;
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
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  removeListeners(canvas: HTMLCanvasElement): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    canvas.removeEventListener('wheel', this.onWheel);
  }

  private syncToAnchor(): void {
    const cameraZ = this.cameraAnchor.z - this.forwardZ * cameraConfig.lookAheadOffset;
    this.camera.position.set(this.cameraAnchor.x, this.cameraHeight, cameraZ);
    this.camera.lookAt(this.cameraAnchor.x, 0, this.cameraAnchor.z);
  }

  private clampAnchor(): void {
    const halfWidth = arenaParams.width / 2 + cameraConfig.boundsPadding;
    const halfLength = arenaParams.length / 2 + cameraConfig.boundsPadding;
    this.cameraAnchor.x = THREE.MathUtils.clamp(this.cameraAnchor.x, -halfWidth, halfWidth);
    this.cameraAnchor.z = THREE.MathUtils.clamp(this.cameraAnchor.z, -halfLength, halfLength);
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
      cameraConfig.maxHeight,
    );
    this.syncToAnchor();
  };

  private isCameraKey(key: string): boolean {
    return ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(key);
  }
}
