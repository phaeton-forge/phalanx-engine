import { FP, type FixedPoint } from '@phalanx-engine/math';
import { TouchControls } from '../ui/TouchControls.ts';

export class InputManager {
  private keys: Set<string> = new Set();
  public mouseDown: boolean = false;
  private mouseJustPressed: boolean = false;
  private spaceJustPressed: boolean = false;
  private reloadJustPressed: boolean = false;

  public aimWorldX: number = 0;
  public aimWorldZ: number = 0;

  private canvas: HTMLCanvasElement;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onContextMenu: (e: MouseEvent) => void;
  private touchControls: TouchControls | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.onKeyDown = (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (e.code === 'KeyR') {
        this.reloadJustPressed = true;
      }
      if (e.code === 'Space') {
        this.spaceJustPressed = true;
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };

    this.onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) {
        this.mouseDown = true;
        this.mouseJustPressed = true;
      }
    };

    this.onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) {
        this.mouseDown = false;
      }
    };

    this.onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      // Track mouse position for aim raycasting
      const rect = this.canvas.getBoundingClientRect();
      this._lastMouseX = e.clientX - rect.left;
      this._lastMouseY = e.clientY - rect.top;
    };

    this.onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('contextmenu', this.onContextMenu);

    const container = canvas.parentElement;
    if (container) {
      this.touchControls = new TouchControls(canvas, container);
    }
  }

  public get moveX(): FixedPoint {
    let x = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (x === 0 && this.touchControls) {
      return FP.FromFloat(this.touchControls.moveX);
    }
    return FP.FromFloat(x);
  }

  public get moveZ(): FixedPoint {
    let z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z -= 1;
    if (z === 0 && this.touchControls) {
      return FP.FromFloat(-this.touchControls.moveY);
    }
    return FP.FromFloat(z);
  }

  public get isFiring(): boolean {
    return this.mouseJustPressed || this.spaceJustPressed;
  }

  public get isSpaceFiring(): boolean {
    return this.keys.has('Space');
  }

  public consumeFire(): boolean {
    if (this.mouseJustPressed) {
      this.mouseJustPressed = false;
      return true;
    }
    if (this.touchControls?.consumeDoubleTap()) {
      return true;
    }
    return false;
  }

  public consumeReload(): boolean {
    if (this.reloadJustPressed) {
      this.reloadJustPressed = false;
      return true;
    }
    return false;
  }

  public consumeSpaceFire(): boolean {
    if (this.spaceJustPressed) {
      this.spaceJustPressed = false;
      return true;
    }
    return false;
  }

  /** Call at end of each tick to clear per-tick state */
  public endTick(): void {
    this.mouseJustPressed = false;
    this.spaceJustPressed = false;
    this.reloadJustPressed = false;
  }

  public get mouseScreenX(): number {
    return this._lastMouseX;
  }

  public get mouseScreenY(): number {
    return this._lastMouseY;
  }

  private _lastMouseX: number = 0;
  private _lastMouseY: number = 0;

  public get hasTouchControls(): boolean {
    return this.touchControls !== null;
  }

  public get joystickAimActive(): boolean {
    return this.touchControls?.aimActive ?? false;
  }

  public get joystickAimX(): number {
    return this.touchControls?.aimX ?? 0;
  }

  public get joystickAimZ(): number {
    return -(this.touchControls?.aimY ?? 0);
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.touchControls?.dispose();
  }
}
