import * as THREE from 'three';

export interface LightingSetup {
  /** Main directional light that casts unit shadows. */
  keyLight: THREE.DirectionalLight;
  /** Hemisphere fill to soften shadowed areas. */
  fillLight: THREE.HemisphereLight;
  /** Back-side rim light to silhouette units against the arena. */
  rimLight: THREE.DirectionalLight;
}

/**
 * Configure cinematic arena lighting for the unit formation grid.
 *
 * - Key light is bright, angled, and shadow-casting.
 * - Fill light keeps shadows from going pure black.
 * - Rim light helps separate unit silhouettes from the dark ground.
 */
export function setupLighting(scene: THREE.Scene): LightingSetup {
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
  keyLight.position.set(20, 35, 15);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 200;
  keyLight.shadow.camera.left = -80;
  keyLight.shadow.camera.right = 80;
  keyLight.shadow.camera.top = 150;
  keyLight.shadow.camera.bottom = -150;
  keyLight.shadow.bias = -0.0005;
  scene.add(keyLight);

  const fillLight = new THREE.HemisphereLight(0xaaccff, 0x223344, 0.45);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0x8899ff, 0.35);
  rimLight.position.set(-15, 20, -25);
  scene.add(rimLight);

  return { keyLight, fillLight, rimLight };
}
