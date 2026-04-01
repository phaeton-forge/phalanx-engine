import { FP, type FixedPoint } from 'phalanx-math';

export class InputManager {
  private keys: Set<string> = new Set();
  public mouseDown: boolean = false;
  private mouseJustPressed: boolean = false;
  private reloadJustPressed: boolean = false;

  public aimWorldX: number = 0;
  public aimWorldZ: number = 0;

  private canvas: HTMLCanvasElement;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onMouseDown: (e: MouseEvent) => void;
  private onMouseUp: (e: MouseEvent) => void;
  private onMouseMove: (e: MouseEvent) => void;
  private onContextMenu: (e: MouseEvent) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.onKeyDown = (e: KeyboardEvent) => {
      this.keys.add(e.code);
      if (e.code === 'KeyR') {
        this.reloadJustPressed = true;
      }
    };

    this.onKeyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    };

    this.onMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.mouseJustPressed = true;
      }
    };

    this.onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        this.mouseDown = false;
      }
    };

    this.onMouseMove = (_e: MouseEvent) => {
      // Aim position is updated via raycasting in PlayerAimSystem
    };

    this.onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  public get moveX(): FixedPoint {
    let x = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    return FP.FromFloat(x);
  }

  public get moveZ(): FixedPoint {
    let z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    return FP.FromFloat(z);
  }

  public get isFiring(): boolean {
    return this.mouseJustPressed || (this.keys.has('Space') && this.mouseJustPressed);
  }

  public get isSpaceFiring(): boolean {
    return this.keys.has('Space');
  }

  public consumeFire(): boolean {
    if (this.mouseJustPressed) {
      this.mouseJustPressed = false;
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
    if (this.keys.has('Space')) {
      // Space is treated as single-fire: we track it via a separate flag
      return false;
    }
    return false;
  }

  /** Call at end of each tick to clear per-tick state */
  public endTick(): void {
    this.mouseJustPressed = false;
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

  public updateMousePosition(e: PointerEvent | MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this._lastMouseX = e.clientX - rect.left;
    this._lastMouseY = e.clientY - rect.top;
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }
}
