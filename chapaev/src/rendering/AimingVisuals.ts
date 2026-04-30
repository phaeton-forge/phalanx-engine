import * as THREE from 'three';

/** Maximum number of vertices in the aim line */
const LINE_SEGMENTS = 2;

/** Sector geometry resolution (higher = smoother arc) */
const SECTOR_SEGMENTS = 28;

// Tuning knobs (kept here so FlickInputSystem stays input-only)
const SECTOR_MIN_ANGLE_RAD = THREE.MathUtils.degToRad(10);
const SECTOR_MAX_ANGLE_RAD = THREE.MathUtils.degToRad(70);
const SECTOR_MIN_RADIUS = 0.9;
const SECTOR_MAX_RADIUS = 4.2;

const OSC_MIN_HZ = 0.3;
const OSC_MAX_HZ = 1.9;

/**
 * AimingVisuals — draws a directional arrow from the flicked checker
 * toward the target direction and a flat sector (piece of a circle) showing the uncertainty area.
 *
 * Colour interpolates green → yellow → red based on force ratio (0..1).
 * The arrow oscillates within the sector, with both sector size and oscillation
 * frequency increasing with force ratio.
 */
export class AimingVisuals {
  private readonly line: THREE.Line;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private readonly scene: THREE.Scene;
  private visible = false;

  private readonly sector: THREE.Mesh;
  private readonly sectorGeometry: THREE.BufferGeometry;
  private readonly sectorMaterial: THREE.MeshBasicMaterial;

  private readonly coneTexture: THREE.Texture;

  // Current state (updated by FlickInputSystem.show + animated by update()).
  private origin = new THREE.Vector3();
  private baseYaw = 0; // radians
  private forceRatio = 0;
  private oscPhase = 0; // radians

  private currentDirX = 0;
  private currentDirZ = 1;

  private lastSectorAngle = -1;
  private lastSectorRadius = -1;

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

    this.coneTexture = createRadialAlphaTexture();
    this.coneTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.coneTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.coneTexture.needsUpdate = true;

    this.sectorGeometry = new THREE.BufferGeometry();
    this.sectorMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      map: this.coneTexture,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.sector = new THREE.Mesh(this.sectorGeometry, this.sectorMaterial);
    this.sector.renderOrder = 998;
    this.sector.visible = false;
    this.scene.add(this.sector);
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
    this.origin.set(originX, originY, originZ);
    this.forceRatio = Math.min(force / maxForce, 1);
    this.baseYaw = Math.atan2(dirX, dirZ); // rotation from +Z toward +X

    const color = computeForceColor(this.forceRatio);
    this.material.color.copy(color);
    this.material.opacity = 0.5 + this.forceRatio * 0.4;
    this.sectorMaterial.color.copy(color);
    this.sectorMaterial.opacity = 0.25 + this.forceRatio * 0.35;

    // Ensure visuals are visible, then let update() animate the arrow direction.
    this.line.visible = true;
    this.sector.visible = true;
    this.visible = true;

    // Update immediately so release in the same frame still has a direction.
    this.update(0);
  }

  /**
   * Advance oscillation and update geometry/materials.
   * @param deltaTime Seconds since last frame.
   */
  public update(deltaTime: number): void {
    if (!this.visible) return;

    const t = this.forceRatio;

    const sectorAngle = lerp(SECTOR_MIN_ANGLE_RAD, SECTOR_MAX_ANGLE_RAD, t);
    const sectorRadius = lerp(SECTOR_MIN_RADIUS, SECTOR_MAX_RADIUS, t);

    // Rebuild sector geometry only when it actually changed.
    if (Math.abs(sectorAngle - this.lastSectorAngle) > 1e-4 || Math.abs(sectorRadius - this.lastSectorRadius) > 1e-3) {
      buildSectorGeometry(this.sectorGeometry, sectorAngle, sectorRadius);
      this.lastSectorAngle = sectorAngle;
      this.lastSectorRadius = sectorRadius;
    }

    // Place sector slightly above the board plane.
    this.sector.position.set(this.origin.x, this.origin.y + 0.02, this.origin.z);
    this.sector.rotation.set(0, this.baseYaw, 0);

    const hz = lerp(OSC_MIN_HZ, OSC_MAX_HZ, t);
    this.oscPhase = normalizeAngleRad(this.oscPhase + deltaTime * hz * Math.PI * 2);

    const halfAngle = sectorAngle * 0.5;
    const offset = Math.sin(this.oscPhase) * halfAngle;
    const yaw = this.baseYaw + offset;

    this.currentDirX = Math.sin(yaw);
    this.currentDirZ = Math.cos(yaw);

    const lineLen = 0.5 + t * 3.5; // visual length 0.5 → 4.0
    const positions = this.geometry.attributes['position'] as THREE.BufferAttribute;
    positions.setXYZ(0, this.origin.x, this.origin.y + 0.05, this.origin.z);
    positions.setXYZ(
      1,
      this.origin.x + this.currentDirX * lineLen,
      this.origin.y + 0.05,
      this.origin.z + this.currentDirZ * lineLen
    );
    positions.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  /** Hide the aim line */
  public hide(): void {
    this.line.visible = false;
    this.sector.visible = false;
    this.visible = false;
  }

  /** Whether the aim line is currently visible */
  public get isVisible(): boolean {
    return this.visible;
  }

  /**
   * Current oscillated (unit) direction in XZ, used for applying the flick.
   * If not visible, returns (0, 1).
   */
  public getCurrentDirectionXZ(): { dirX: number; dirZ: number } {
    return { dirX: this.currentDirX, dirZ: this.currentDirZ };
  }

  /** Dispose GPU resources */
  public dispose(): void {
    this.scene.remove(this.line);
    this.scene.remove(this.sector);
    this.geometry.dispose();
    this.material.dispose();
    this.sectorGeometry.dispose();
    this.sectorMaterial.dispose();
    this.coneTexture.dispose();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function normalizeAngleRad(a: number): number {
  // keep phase bounded to avoid float blow-up
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}

function computeForceColor(t: number): THREE.Color {
  const color = new THREE.Color();
  if (t < 0.5) {
    color.setRGB(t * 2, 1, 0);
  } else {
    color.setRGB(1, 1 - (t - 0.5) * 2, 0);
  }
  return color;
}

function createRadialAlphaTexture(): THREE.Texture {
  // Horizontal gradient: u=0 (near checker) more opaque, u=1 (edge) more transparent.
  if (typeof document === 'undefined') {
    // Headless/test environment: use a tiny DataTexture fallback.
    const data = new Uint8Array([
      255, 255, 255, 153, // alpha ~0.60
      255, 255, 255, 0,   // alpha 0.0
    ]);
    const tex = new THREE.DataTexture(data, 2, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Fallback: solid texture
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.60)');
  grad.addColorStop(1, 'rgba(255,255,255,0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function buildSectorGeometry(geometry: THREE.BufferGeometry, sectorAngle: number, radius: number): void {
  // Builds a triangle fan in the XZ plane, centered on +Z, spanning [-half..+half].
  const half = sectorAngle * 0.5;
  const vertexCount = 1 + (SECTOR_SEGMENTS + 1); // center + arc points

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  // Center
  positions[0] = 0;
  positions[1] = 0;
  positions[2] = 0;
  uvs[0] = 0;
  uvs[1] = 0.5;

  for (let i = 0; i <= SECTOR_SEGMENTS; i++) {
    const t = i / SECTOR_SEGMENTS;
    const a = -half + t * sectorAngle;
    const x = Math.sin(a) * radius;
    const z = Math.cos(a) * radius;
    const vi = 1 + i;
    positions[vi * 3 + 0] = x;
    positions[vi * 3 + 1] = 0;
    positions[vi * 3 + 2] = z;

    // u = radial distance (0 at center, 1 at edge). v = along arc (unused by 1D gradient but stable).
    uvs[vi * 2 + 0] = 1;
    uvs[vi * 2 + 1] = t;
  }

  const indices: number[] = [];
  for (let i = 0; i < SECTOR_SEGMENTS; i++) {
    const a = 0;
    const b = 1 + i;
    const c = 1 + i + 1;
    indices.push(a, b, c);
  }

  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

