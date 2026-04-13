import * as THREE from 'three';

/** Maximum number of vertices in the aim line */
const LINE_SEGMENTS = 2;

/**
 * AimingVisuals — draws a directional arrow from the flicked checker
 * toward the target direction. Uses a simple Three.js Line.
 *
 * Colour interpolates green → yellow → red based on force ratio.
 */
export class AimingVisuals {
  private readonly line: THREE.Line;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private readonly scene: THREE.Scene;
  private visible = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const positions = new Float32Array(LINE_SEGMENTS * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.material = new THREE.LineBasicMaterial({
      color: 0x00ff00,
      linewidth: 2,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    });

    this.line = new THREE.Line(this.geometry, this.material);
    this.line.renderOrder = 999;
    this.line.visible = false;
    this.scene.add(this.line);
  }

  /**
   * Show / update the aim line.
   *
   * @param originX  World X of the checker being flicked
   * @param originY  World Y (top of checker)
   * @param originZ  World Z of the checker being flicked
   * @param dirX     Normalised aim direction X (flight direction, opposite to drag)
   * @param dirZ     Normalised aim direction Z
   * @param force    Current force magnitude (0..maxForce)
   * @param maxForce Maximum allowed force
   */
  public show(
    originX: number, originY: number, originZ: number,
    dirX: number, dirZ: number,
    force: number, maxForce: number,
  ): void {
    const t = Math.min(force / maxForce, 1);
    const lineLen = 0.5 + t * 3.5; // visual length 0.5 → 4.0

    const positions = this.geometry.attributes['position'] as THREE.BufferAttribute;
    positions.setXYZ(0, originX, originY + 0.05, originZ);
    positions.setXYZ(1, originX + dirX * lineLen, originY + 0.05, originZ + dirZ * lineLen);
    positions.needsUpdate = true;
    this.geometry.computeBoundingSphere();

    // Colour: green → yellow → red
    const color = new THREE.Color();
    if (t < 0.5) {
      color.setRGB(t * 2, 1, 0);
    } else {
      color.setRGB(1, 1 - (t - 0.5) * 2, 0);
    }
    this.material.color.copy(color);
    this.material.opacity = 0.5 + t * 0.4;

    this.line.visible = true;
    this.visible = true;
  }

  /** Hide the aim line */
  public hide(): void {
    this.line.visible = false;
    this.visible = false;
  }

  /** Whether the aim line is currently visible */
  public get isVisible(): boolean {
    return this.visible;
  }

  /** Dispose GPU resources */
  public dispose(): void {
    this.scene.remove(this.line);
    this.geometry.dispose();
    this.material.dispose();
  }
}

