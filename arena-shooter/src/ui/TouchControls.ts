import { VirtualJoystick } from './VirtualJoystick.ts';

export class TouchControls {
  private readonly leftJoystick: VirtualJoystick;
  private readonly rightJoystick: VirtualJoystick;
  private readonly canvas: HTMLCanvasElement;

  private leftPointerId: number | null = null;
  private rightPointerId: number | null = null;

  /** Tracks whether the right joystick had a non-trivial deflection during the current touch. */
  private rightWasMoved: boolean = false;

  private lastRightTapTime: number = 0;
  private _doubleTapped: boolean = false;
  private static readonly DOUBLE_TAP_MS = 300;

  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;

  constructor(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.canvas = canvas;

    const maxDist = 50;
    this.leftJoystick = new VirtualJoystick(container, maxDist, 'rgba(0,180,255,0.35)');
    this.rightJoystick = new VirtualJoystick(container, maxDist, 'rgba(255,100,50,0.35)');

    this.onDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return;

      const rect = this.canvas.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const half = rect.width / 2;

      if (relX < half) {
        if (this.leftPointerId !== null) return;
        this.leftPointerId = e.pointerId;
        this.leftJoystick.show(relX, relY);
      } else {
        if (this.rightPointerId !== null) return;
        this.rightPointerId = e.pointerId;
        this.rightWasMoved = false;
        this.rightJoystick.show(relX, relY);

        const now = performance.now();
        if (now - this.lastRightTapTime < TouchControls.DOUBLE_TAP_MS) {
          this._doubleTapped = true;
        }
        this.lastRightTapTime = now;
      }
    };

    this.onMove = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return;

      const rect = this.canvas.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;

      if (e.pointerId === this.leftPointerId) {
        this.leftJoystick.move(relX, relY);
      } else if (e.pointerId === this.rightPointerId) {
        this.rightJoystick.move(relX, relY);
        const mag = Math.sqrt(
          this.rightJoystick.dx * this.rightJoystick.dx +
          this.rightJoystick.dy * this.rightJoystick.dy,
        );
        if (mag > 0.15) {
          this.rightWasMoved = true;
        }
      }
    };

    this.onUp = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return;

      if (e.pointerId === this.leftPointerId) {
        this.leftPointerId = null;
        this.leftJoystick.hide();
      } else if (e.pointerId === this.rightPointerId) {
        this.rightPointerId = null;
        this.rightJoystick.hide();
      }
    };

    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  /** Movement X: -1 (left) to 1 (right) */
  public get moveX(): number { return this.leftJoystick.dx; }

  /** Movement Y: -1 (screen-up) to 1 (screen-down) */
  public get moveY(): number { return this.leftJoystick.dy; }

  /** Aim X: -1 to 1 */
  public get aimX(): number { return this.rightJoystick.dx; }

  /** Aim Y: -1 to 1 */
  public get aimY(): number { return this.rightJoystick.dy; }

  /** Whether the aim joystick is currently being touched */
  public get aimActive(): boolean { return this.rightJoystick.active; }

  /** Whether the right joystick had a non-trivial deflection during its current/last touch */
  public get aimWasMoved(): boolean { return this.rightWasMoved; }

  /** Consume a double-tap event detected on the right side */
  public consumeDoubleTap(): boolean {
    if (this._doubleTapped) {
      this._doubleTapped = false;
      return true;
    }
    return false;
  }

  public dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.leftJoystick.dispose();
    this.rightJoystick.dispose();
  }
}
