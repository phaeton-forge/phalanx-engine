import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR,
  CAMERA_POSITION,
  CAMERA_MIN_DISTANCE,
  CAMERA_MAX_DISTANCE,
  CAMERA_MIN_POLAR_ANGLE,
  CAMERA_MAX_POLAR_ANGLE,
  DIR_LIGHT_COLOR,
  DIR_LIGHT_INTENSITY,
  AMBIENT_LIGHT_COLOR,
  AMBIENT_LIGHT_INTENSITY,
  HEMISPHERE_SKY_COLOR,
  HEMISPHERE_GROUND_COLOR,
  HEMISPHERE_INTENSITY,
  FILL_LIGHT_COLOR,
  FILL_LIGHT_INTENSITY,
  SHADOW_MAP_SIZE,
  TABLE_SIZE,
  BOARD_EXTENT,
  TABLE_BORDER_THICKNESS,
  TABLE_BORDER_HEIGHT,
  TABLE_NORMAL_SCALE,
  TABLE_AO_INTENSITY,
  TABLE_ENV_MAP_INTENSITY,
  TABLE_BORDER_ROUGHNESS,
  TABLE_BORDER_METALNESS,
  TABLE_BORDER_COLOR_TINT,
  VIGNETTE_OFFSET,
  VIGNETTE_DARKNESS,
  BLOOM_THRESHOLD,
  BLOOM_STRENGTH,
  BLOOM_RADIUS,
} from '../config/constants.ts';
import { assetManager } from './AssetManager.ts';
import { BOARD_TEXTURES } from './AssetManifest.ts';

/**
 * Screen-space vignette: darkens the edges of the frame for a
 * cinematic, cosy look. Applied before tone-mapping (linear space).
 */
const VignetteShader = {
  name: 'VignetteShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    offset: { value: 1.0 },
    darkness: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
      texel.rgb *= clamp(1.0 - darkness * dot(uv, uv), 0.0, 1.0);
      gl_FragColor = texel;
    }
  `,
};

export interface SceneContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly composer: EffectComposer;
}

/**
 * Initialises Three.js renderer, scene, camera, lights, and controls.
 * Returns a SceneContext for further use.
 */
export function setupScene(canvas: HTMLCanvasElement): SceneContext {
  // ── Renderer ─────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // ── Scene ────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2b1d0e); // fallback until HDR loads

  // ── HDR Environment ──────────────────────────────────────────
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const exrTexture = assetManager.getEnvTexture();
  exrTexture.mapping = THREE.EquirectangularReflectionMapping;

  const envMap = pmremGenerator.fromEquirectangular(exrTexture).texture;

  // Pre-filtered cubemap for PBR reflections on checkers & board
  scene.environment = envMap;

  // Blurred HDR as background
  scene.background = envMap;
  scene.backgroundBlurriness = 0.15;
  scene.backgroundIntensity = 0.85;

  exrTexture.dispose();
  pmremGenerator.dispose();

  // ── Camera ───────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(
    CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    CAMERA_NEAR,
    CAMERA_FAR
  );
  camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
  applyAspectFov(camera);

  // ── OrbitControls ────────────────────────────────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = CAMERA_MIN_DISTANCE;
  controls.maxDistance = CAMERA_MAX_DISTANCE;
  controls.minPolarAngle = CAMERA_MIN_POLAR_ANGLE;
  controls.maxPolarAngle = CAMERA_MAX_POLAR_ANGLE;
  controls.update();

  // ── Lights ───────────────────────────────────────────────────

  // Main directional (warm lamp-like, lower angle for longer shadows)
  const dirLight = new THREE.DirectionalLight(
    DIR_LIGHT_COLOR,
    DIR_LIGHT_INTENSITY
  );
  dirLight.position.set(9, 4.5, 2);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = SHADOW_MAP_SIZE;
  dirLight.shadow.mapSize.height = SHADOW_MAP_SIZE;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = 40;
  dirLight.shadow.bias = 0.001;
  dirLight.shadow.normalBias = 0.01;
  dirLight.shadow.radius = 20; // soft, diffused shadows
  // Tight frustum around the board → higher shadow-texel density
  const shadowExtent = BOARD_EXTENT * 2;
  dirLight.shadow.camera.left = -shadowExtent;
  dirLight.shadow.camera.right = shadowExtent;
  dirLight.shadow.camera.top = shadowExtent;
  dirLight.shadow.camera.bottom = -shadowExtent;
  scene.add(dirLight);

  // Cool fill from the opposite side — prevents pure-black shadows
  const fillLight = new THREE.DirectionalLight(
    FILL_LIGHT_COLOR,
    FILL_LIGHT_INTENSITY
  );
  fillLight.position.set(-6, 8, -4);
  scene.add(fillLight);

  // Soft ambient fill
  const ambientLight = new THREE.AmbientLight(
    AMBIENT_LIGHT_COLOR,
    AMBIENT_LIGHT_INTENSITY
  );
  scene.add(ambientLight);

  // Hemisphere (sky / ground gradient)
  const hemiLight = new THREE.HemisphereLight(
    HEMISPHERE_SKY_COLOR,
    HEMISPHERE_GROUND_COLOR,
    HEMISPHERE_INTENSITY
  );
  scene.add(hemiLight);

  // ── Table plane ──────────────────────────────────────────────
  const tableRepeat = 6;

  const tableColorTex = assetManager.getTexture(BOARD_TEXTURES.color).clone();
  tableColorTex.colorSpace = THREE.SRGBColorSpace;
  const tableNormalTex = assetManager.getTexture(BOARD_TEXTURES.normal).clone();
  const tableRoughTex = assetManager
    .getTexture(BOARD_TEXTURES.roughness)
    .clone();
  const tableAoTex = assetManager
    .getTexture(BOARD_TEXTURES.ambientOcclusion)
    .clone();

  for (const tex of [
    tableColorTex,
    tableNormalTex,
    tableRoughTex,
    tableAoTex,
  ]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(tableRepeat, tableRepeat);
  }

  const tableMat = new THREE.MeshStandardMaterial({
    map: tableColorTex,
    normalMap: tableNormalTex,
    normalScale: new THREE.Vector2(TABLE_NORMAL_SCALE, TABLE_NORMAL_SCALE),
    roughnessMap: tableRoughTex,
    roughness: 0.92,
    metalness: 0.0,
    aoMap: tableAoTex,
    aoMapIntensity: TABLE_AO_INTENSITY,
    envMapIntensity: TABLE_ENV_MAP_INTENSITY,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const tableGeo = new THREE.PlaneGeometry(TABLE_SIZE, TABLE_SIZE);
  // aoMap reads from UV channel 1 — copy UV0 → UV1
  tableGeo.setAttribute('uv1', tableGeo.getAttribute('uv'));
  const tableMesh = new THREE.Mesh(tableGeo, tableMat);
  tableMesh.rotation.x = -Math.PI / 2;
  tableMesh.position.y = -BOARD_EXTENT * 0.02 - 0.005; // offset below border bottoms to prevent z-fighting
  tableMesh.receiveShadow = true;
  scene.add(tableMesh);

  // ── Table border (raised rails) ──────────────────────────────
  const borderColorTex = assetManager.getTexture(BOARD_TEXTURES.color).clone();
  borderColorTex.colorSpace = THREE.SRGBColorSpace;
  const borderNormalTex = assetManager
    .getTexture(BOARD_TEXTURES.normal)
    .clone();
  const borderRoughTex = assetManager
    .getTexture(BOARD_TEXTURES.roughness)
    .clone();

  for (const tex of [borderColorTex, borderNormalTex, borderRoughTex]) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }

  const borderMat = new THREE.MeshStandardMaterial({
    map: borderColorTex,
    normalMap: borderNormalTex,
    roughnessMap: borderRoughTex,
    roughness: TABLE_BORDER_ROUGHNESS,
    metalness: TABLE_BORDER_METALNESS,
    color: new THREE.Color(TABLE_BORDER_COLOR_TINT),
  });

  const tableHalf = TABLE_SIZE / 2;
  const borderY = -BOARD_EXTENT * 0.02 + TABLE_BORDER_HEIGHT / 2;

  // Long sides (along X axis) — front and back
  const longGeo = new THREE.BoxGeometry(
    TABLE_SIZE,
    TABLE_BORDER_HEIGHT,
    TABLE_BORDER_THICKNESS
  );
  scaleBoxUVs(longGeo, TABLE_SIZE, TABLE_BORDER_HEIGHT, TABLE_BORDER_THICKNESS);

  // Short sides (along Z axis) — left and right (inner length to avoid overlap at corners)
  const innerLength = TABLE_SIZE - TABLE_BORDER_THICKNESS * 2;
  const shortGeo = new THREE.BoxGeometry(
    TABLE_BORDER_THICKNESS,
    TABLE_BORDER_HEIGHT,
    innerLength
  );
  scaleBoxUVs(
    shortGeo,
    TABLE_BORDER_THICKNESS,
    TABLE_BORDER_HEIGHT,
    innerLength
  );

  const borderPositions: [THREE.BoxGeometry, number, number, number][] = [
    [longGeo, 0, borderY, -(tableHalf - TABLE_BORDER_THICKNESS / 2)], // back  (-Z)
    [longGeo, 0, borderY, tableHalf - TABLE_BORDER_THICKNESS / 2], // front (+Z)
    [shortGeo, -(tableHalf - TABLE_BORDER_THICKNESS / 2), borderY, 0], // left  (-X)
    [shortGeo, tableHalf - TABLE_BORDER_THICKNESS / 2, borderY, 0], // right (+X)
  ];

  for (const [geo, x, y, z] of borderPositions) {
    const wall = new THREE.Mesh(geo, borderMat);
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  // ── Post-processing ──────────────────────────────────────────
  // Use a multisample render target so antialiasing survives post-processing
  const renderTarget = new THREE.WebGLRenderTarget(
    window.innerWidth,
    window.innerHeight,
    { samples: Math.min(renderer.capabilities.maxSamples, 4) }
  );
  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));

  // Bloom — makes emissive checker highlights glow
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD
  );
  composer.addPass(bloomPass);

  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.uniforms['offset'].value = VIGNETTE_OFFSET;
  vignettePass.uniforms['darkness'].value = VIGNETTE_DARKNESS;
  composer.addPass(vignettePass);

  composer.addPass(new OutputPass());

  // ── Resize handler ──────────────────────────────────────────
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    applyAspectFov(camera);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, controls, composer };
}

/**
 * Keep the board framed across orientations. `CAMERA_FOV` is tuned for a
 * portrait-ish viewport (vertical FOV). In a wide/landscape viewport that
 * same vertical FOV leaves the board looking distant and tiny, because the
 * board's width — not its height — is now the limiting dimension.
 *
 * Fix: below a reference aspect we keep the design FOV; above it we treat
 * `CAMERA_FOV` as the *horizontal* FOV target and derive the vertical FOV
 * from the current aspect (Hor+ framing). This widens the vertical FOV as
 * the viewport gets wider, so the board keeps filling the short axis. A
 * clamp stops the FOV from blowing up on extreme aspects.
 */
function applyAspectFov(camera: THREE.PerspectiveCamera): void {
  const REFERENCE_ASPECT = 1; // at/below square, use the design FOV as-is
  const MAX_FOV = 100; // guard against extreme wide viewports
  const aspect = camera.aspect;

  if (aspect <= REFERENCE_ASPECT) {
    camera.fov = CAMERA_FOV;
    return;
  }

  // Treat CAMERA_FOV as the horizontal FOV we want to preserve, then solve
  // for the vertical FOV that yields it at the current aspect ratio.
  const halfH = THREE.MathUtils.degToRad(CAMERA_FOV) / 2;
  const targetHorizontal = 2 * Math.atan(Math.tan(halfH) * REFERENCE_ASPECT);
  const verticalFov = 2 * Math.atan(Math.tan(targetHorizontal / 2) / aspect);
  camera.fov = Math.min(THREE.MathUtils.radToDeg(verticalFov), MAX_FOV);
}

/**
 * Rescale the UV attribute of a BoxGeometry so that each face tiles
 * the texture at 1 unit = 1 texture repeat in world space.
 *
 * BoxGeometry emits 6 groups (face order): +X, -X, +Y, -Y, +Z, -Z.
 * Default UVs go 0→1 across each face regardless of size.
 * We multiply them by the world-space dimensions of that face.
 */
function scaleBoxUVs(
  geo: THREE.BoxGeometry,
  sizeX: number,
  sizeY: number,
  sizeZ: number
): void {
  const uv = geo.getAttribute('uv');
  const normal = geo.getAttribute('normal');

  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));

    let u = uv.getX(i);
    let v = uv.getY(i);

    if (nx > 0.5) {
      // ±X face → spans Z × Y
      u *= sizeZ;
      v *= sizeY;
    } else if (ny > 0.5) {
      // ±Y face → spans X × Z
      u *= sizeX;
      v *= sizeZ;
    } else if (nz > 0.5) {
      // ±Z face → spans X × Y
      u *= sizeX;
      v *= sizeY;
    }

    uv.setXY(i, u, v);
  }

  uv.needsUpdate = true;
}
