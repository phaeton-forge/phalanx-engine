import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { CameraController } from '../src/core/CameraController';

const windowListeners = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

vi.stubGlobal('window', windowListeners);

function createCanvas(): HTMLCanvasElement {
  const canvas = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  };
  return canvas as unknown as HTMLCanvasElement;
}

function createTouch(
  identifier: number,
  clientX: number,
  clientY: number
): Touch {
  return {
    identifier,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
    pageX: clientX,
    pageY: clientY,
    radiusX: 1,
    radiusY: 1,
    rotationAngle: 0,
    force: 1,
    target: {} as EventTarget,
  } as Touch;
}

function createTouchList(touches: Touch[]): TouchList {
  const list = {
    length: touches.length,
    item: (index: number) => touches[index] ?? null,
  };
  touches.forEach((touch, index) => {
    Object.defineProperty(list, index, { value: touch, enumerable: true });
  });
  return list as unknown as TouchList;
}

function createTouchEvent(
  type: string,
  touches: Touch[],
  changedTouches: Touch[] = touches
): TouchEvent {
  const event = {
    type,
    touches: createTouchList(touches),
    changedTouches: createTouchList(changedTouches),
    targetTouches: createTouchList(touches),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  return event as unknown as TouchEvent;
}

describe('CameraController touch pan', () => {
  let controller: CameraController;
  let canvas: HTMLCanvasElement;
  let touchStart: (event: TouchEvent) => void;
  let touchMove: (event: TouchEvent) => void;
  let touchEnd: (event: TouchEvent) => void;

  beforeEach(() => {
    controller = new CameraController(0);
    canvas = createCanvas();
    controller.onResize(800, 600);
    controller.addListeners(canvas);

    const addCalls = vi.mocked(canvas.addEventListener).mock.calls;
    touchStart = addCalls.find((c) => c[0] === 'touchstart')?.[1] as (
      event: TouchEvent
    ) => void;
    touchMove = addCalls.find((c) => c[0] === 'touchmove')?.[1] as (
      event: TouchEvent
    ) => void;
    touchEnd = addCalls.find((c) => c[0] === 'touchend')?.[1] as (
      event: TouchEvent
    ) => void;
  });

  afterEach(() => {
    controller.removeListeners(canvas);
  });

  it('pans the camera anchor when a single finger drags across the canvas', () => {
    const startX = controller.camera.position.x;

    touchStart(createTouchEvent('touchstart', [createTouch(1, 400, 300)]));
    touchMove(createTouchEvent('touchmove', [createTouch(1, 450, 300)]));

    // Dragging right should move the look-at anchor (grab-the-ground).
    expect(controller.camera.position.x).not.toBe(startX);
  });

  it('ignores touch pan while blocked (formation unit drag)', () => {
    const startX = controller.camera.position.x;
    const startZ = controller.camera.position.z;

    controller.setTouchPanBlocked(true);
    touchStart(createTouchEvent('touchstart', [createTouch(1, 400, 300)]));
    touchMove(createTouchEvent('touchmove', [createTouch(1, 480, 360)]));

    expect(controller.camera.position.x).toBe(startX);
    expect(controller.camera.position.z).toBe(startZ);
  });

  it('clears an in-flight pan when touch pan becomes blocked', () => {
    touchStart(createTouchEvent('touchstart', [createTouch(1, 400, 300)]));
    const midX = controller.camera.position.x;

    controller.setTouchPanBlocked(true);
    touchMove(createTouchEvent('touchmove', [createTouch(1, 500, 300)]));

    expect(controller.camera.position.x).toBe(midX);
  });

  it('pinches to change camera height', () => {
    const startY = controller.camera.position.y;

    touchStart(
      createTouchEvent('touchstart', [
        createTouch(1, 350, 300),
        createTouch(2, 450, 300),
      ])
    );
    // Fingers closer together → zoom out → higher camera.
    touchMove(
      createTouchEvent('touchmove', [
        createTouch(1, 380, 300),
        createTouch(2, 420, 300),
      ])
    );

    expect(controller.camera.position.y).toBeGreaterThan(startY);
  });

  it('ends the gesture on touchend', () => {
    touchStart(createTouchEvent('touchstart', [createTouch(1, 400, 300)]));
    touchMove(createTouchEvent('touchmove', [createTouch(1, 430, 300)]));
    const afterPanX = controller.camera.position.x;

    touchEnd(createTouchEvent('touchend', [], [createTouch(1, 430, 300)]));
    // Orphan move after end must not pan further.
    touchMove(createTouchEvent('touchmove', [createTouch(1, 500, 300)]));

    expect(controller.camera.position.x).toBe(afterPanX);
  });
});
