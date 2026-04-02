export class VirtualJoystick {
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly maxDistance: number;

  private originX: number = 0;
  private originY: number = 0;

  private _dx: number = 0;
  private _dy: number = 0;
  private _active: boolean = false;

  constructor(container: HTMLElement, maxDistance: number, knobColor: string) {
    this.maxDistance = maxDistance;

    const baseSize = Math.round(maxDistance * 2.4);
    const knobSize = Math.round(maxDistance * 1.0);

    this.base = document.createElement('div');
    this.base.style.cssText = [
      'position:absolute',
      `width:${baseSize}px`,
      `height:${baseSize}px`,
      'border-radius:50%',
      'background:rgba(255,255,255,0.08)',
      'border:2px solid rgba(136,204,255,0.25)',
      'transform:translate(-50%,-50%)',
      'pointer-events:none',
      'display:none',
      'z-index:100',
    ].join(';');

    this.knob = document.createElement('div');
    this.knob.style.cssText = [
      'position:absolute',
      `width:${knobSize}px`,
      `height:${knobSize}px`,
      'border-radius:50%',
      `background:${knobColor}`,
      'border:2px solid rgba(136,204,255,0.5)',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'pointer-events:none',
    ].join(';');

    this.base.appendChild(this.knob);
    container.appendChild(this.base);
  }

  public show(x: number, y: number): void {
    this.originX = x;
    this.originY = y;
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
    this.base.style.display = 'block';
    this._active = true;
    this._dx = 0;
    this._dy = 0;
    this.setKnobOffset(0, 0);
  }

  public move(x: number, y: number): void {
    if (!this._active) return;

    let dx = x - this.originX;
    let dy = y - this.originY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > this.maxDistance) {
      dx = (dx / dist) * this.maxDistance;
      dy = (dy / dist) * this.maxDistance;
    }

    this._dx = dx / this.maxDistance;
    this._dy = dy / this.maxDistance;
    this.setKnobOffset(dx, dy);
  }

  public hide(): void {
    this._active = false;
    this._dx = 0;
    this._dy = 0;
    this.base.style.display = 'none';
    this.setKnobOffset(0, 0);
  }

  private setKnobOffset(dx: number, dy: number): void {
    this.knob.style.left = `calc(50% + ${dx}px)`;
    this.knob.style.top = `calc(50% + ${dy}px)`;
  }

  public get dx(): number { return this._dx; }
  public get dy(): number { return this._dy; }
  public get active(): boolean { return this._active; }

  public dispose(): void {
    this.base.remove();
  }
}
