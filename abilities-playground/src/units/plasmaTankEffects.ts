import * as THREE from 'three';
import { getSoftCircleTexture } from '../cues/vfxHelpers';

/** glTF empty at the barrel tip — MachineGunFireCue reads this via root.userData. */
export const MUZZLE_FLASH_POINT_NAME = 'MuzzleFlashPoint';
/** glTF turret mesh — MachineGunFireCue kicks this for muzzle recoil. */
export const TURRET_NAME = 'Turret';

const ENGINE_BLUE_NAMES = ['EngineBlue_L', 'EngineBlue_R'] as const;
const ENGINE_RED_NAMES = [
  'EngineRed_LB',
  'EngineRed_LT',
  'EngineRed_RB',
  'EngineRed_RT',
] as const;

/** Exhaust shoots along local −Z (engines sit on the rear face of Base). */
const EXHAUST_DIR = new THREE.Vector3(0, 0, -1);

type ThrusterStyle = {
  color: number;
  /**
   * `sphere` — volumetric bulb + billboard halo (nozzle-tip look).
   * `panel` — flattened lens that stays flush with the hull vent.
   */
  shape: 'sphere' | 'panel';
  coreRadius: number;
  /** Radius of the soft billboard halo around the core (sphere shape only). */
  glowRadius: number;
  /** Full extents of the flattened lens (panel shape only). */
  panelWidth: number;
  panelHeight: number;
  /** Brightness pulse rate in rad/s — red and blue intentionally differ. */
  pulseSpeed: number;
  /** Opacity swing around the base level. */
  pulseAmount: number;
  baseOpacity: number;
  particleCount: number;
  particleSize: number;
  particleSpeed: number;
};

const BLUE_STYLE: ThrusterStyle = {
  color: 0x66d4ff,
  shape: 'panel',
  coreRadius: 0,
  glowRadius: 0,
  panelWidth: 0.3,
  panelHeight: 0.17,
  pulseSpeed: 3.1,
  pulseAmount: 0.18,
  baseOpacity: 0.8,
  particleCount: 0,
  particleSize: 0,
  particleSpeed: 0,
};

const RED_STYLE: ThrusterStyle = {
  color: 0xff5a3a,
  shape: 'sphere',
  coreRadius: 0.1,
  glowRadius: 0.2,
  panelWidth: 0,
  panelHeight: 0,
  pulseSpeed: 7.4,
  pulseAmount: 0.28,
  baseOpacity: 0.65,
  particleCount: 12,
  particleSize: 0.2,
  particleSpeed: 2.2,
};

/**
 * Resolve hierarchy sockets on a cloned Plasma Tank model and attach constant
 * thruster VFX. Stores `muzzleFlashPoint` / `turret` on `unitRoot.userData`
 * for cues.
 */
export function bindPlasmaTankEffects(
  unitRoot: THREE.Object3D,
  modelRoot: THREE.Object3D
): void {
  const muzzle = modelRoot.getObjectByName(MUZZLE_FLASH_POINT_NAME);
  if (muzzle) {
    unitRoot.userData.muzzleFlashPoint = muzzle;
  }

  const turret = modelRoot.getObjectByName(TURRET_NAME);
  if (turret) {
    // Authored rest pose — recoil animates from this so overlapping cues don't
    // drift the turret if a previous kick didn't fully restore.
    turret.userData.restLocalPosition = turret.position.clone();
    // Authored yaw of the turret node (the model bakes a 90° twist into it).
    // Traverse angles from RotationSystem are applied on top of this, so the
    // rest pose keeps the barrel aligned with the hull's forward axis.
    turret.userData.restLocalYaw = turret.rotation.y;
    unitRoot.userData.turret = turret;
  }

  for (const name of ENGINE_BLUE_NAMES) {
    const socket = modelRoot.getObjectByName(name);
    if (socket) socket.add(createThrusterVfx(BLUE_STYLE));
  }
  for (const name of ENGINE_RED_NAMES) {
    const socket = modelRoot.getObjectByName(name);
    if (socket) socket.add(createThrusterVfx(RED_STYLE));
  }
}

/**
 * Glow core (+ looping particle spray for styles that emit), parented to an
 * engine empty so it rides the unit transform. Self-animates via
 * `onBeforeRender`: brightness-only pulse, no scale changes.
 */
function createThrusterVfx(style: ThrusterStyle): THREE.Group {
  const group = new THREE.Group();
  group.userData.isThrusterVfx = true;

  const coreMat = new THREE.MeshBasicMaterial({
    color: style.color,
    transparent: true,
    opacity: style.baseOpacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const glowMats: THREE.Material[] = [coreMat];
  let ticker: THREE.Object3D;

  if (style.shape === 'panel') {
    // Flattened lens that hugs the hull vent instead of ballooning out of it.
    const panel = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 10),
      coreMat
    );
    panel.scale.set(
      style.panelWidth,
      style.panelHeight,
      style.panelHeight * 0.7
    );
    panel.position.z = -style.panelHeight * 0.15;
    group.add(panel);
    ticker = panel;
  } else {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(style.coreRadius, 12, 8),
      coreMat
    );
    group.add(core);

    // Soft additive billboard so the engine reads as a glow, not a solid shape.
    const glowMat = new THREE.SpriteMaterial({
      color: style.color,
      map: getSoftCircleTexture(),
      transparent: true,
      opacity: style.baseOpacity * 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(style.glowRadius * 2);
    group.add(glow);
    glowMats.push(glowMat);
    ticker = core;
  }

  const phase = Math.random() * Math.PI * 2;

  const pulseBrightness = (now: number): number => {
    const wave = 0.5 + 0.5 * Math.sin(now * 0.001 * style.pulseSpeed + phase);
    const opacity = style.baseOpacity + style.pulseAmount * (wave - 0.5) * 2;
    coreMat.opacity = THREE.MathUtils.clamp(opacity, 0.05, 1);
    for (let i = 1; i < glowMats.length; i++) {
      glowMats[i].opacity = THREE.MathUtils.clamp(opacity * 0.7, 0.03, 1);
    }
    return wave;
  };

  const particleCount = style.particleCount;
  if (particleCount === 0) {
    ticker.onBeforeRender = () => {
      pulseBrightness(performance.now());
    };
    return group;
  }

  const positions = new Float32Array(particleCount * 3);
  const ages = new Float32Array(particleCount);
  const lifetimes = new Float32Array(particleCount);
  const velocities = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    resetParticle(i, ages, lifetimes, velocities, positions, style, true);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const pointsMat = new THREE.PointsMaterial({
    color: style.color,
    map: getSoftCircleTexture(),
    size: style.particleSize,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, pointsMat);
  points.frustumCulled = false;
  group.add(points);

  let lastTime = performance.now();

  // Groups are not drawn; hook the points so the emitter keeps ticking.
  points.onBeforeRender = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    const wave = pulseBrightness(now);

    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < particleCount; i++) {
      ages[i] += dt;
      if (ages[i] >= lifetimes[i]) {
        resetParticle(i, ages, lifetimes, velocities, positions, style, false);
        continue;
      }
      const ix = i * 3;
      positions[ix] += velocities[ix] * dt;
      positions[ix + 1] += velocities[ix + 1] * dt;
      positions[ix + 2] += velocities[ix + 2] * dt;
      // Mild drag so the spray densifies near the nozzle.
      velocities[ix] *= 1 - 0.6 * dt;
      velocities[ix + 1] *= 1 - 0.6 * dt;
      velocities[ix + 2] *= 1 - 0.35 * dt;
    }
    attr.needsUpdate = true;

    const fade =
      ages.reduce((sum, age, i) => sum + (1 - age / lifetimes[i]), 0) /
      particleCount;
    // Particles ride the same brightness pulse as the core.
    pointsMat.opacity =
      (0.3 + 0.5 * fade) * (1 - style.pulseAmount + style.pulseAmount * wave);
  };

  return group;
}

function resetParticle(
  index: number,
  ages: Float32Array,
  lifetimes: Float32Array,
  velocities: Float32Array,
  positions: Float32Array,
  style: ThrusterStyle,
  stagger: boolean
): void {
  ages[index] = stagger ? Math.random() * 0.35 : 0;
  lifetimes[index] = 0.25 + Math.random() * 0.35;
  const ix = index * 3;
  positions[ix] = (Math.random() - 0.5) * style.coreRadius * 0.6;
  positions[ix + 1] = (Math.random() - 0.5) * style.coreRadius * 0.6;
  positions[ix + 2] = (Math.random() - 0.5) * 0.04;

  const speed = style.particleSpeed * (0.7 + Math.random() * 0.6);
  const spread = 0.35;
  velocities[ix] = EXHAUST_DIR.x * speed + (Math.random() - 0.5) * spread;
  velocities[ix + 1] = EXHAUST_DIR.y * speed + (Math.random() - 0.5) * spread;
  velocities[ix + 2] =
    EXHAUST_DIR.z * speed + (Math.random() - 0.5) * spread * 0.4;
}
