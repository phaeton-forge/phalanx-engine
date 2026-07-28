import * as THREE from 'three';
import { assetManager, MODEL_KEYS } from '../assets';

/**
 * Target horizontal footprint (world units) per `visual.size`, matching the
 * old procedural fuselage's long-axis dimension (`size * 1.5`). Keeps the
 * imported model's on-field scale consistent with `UnitDefinition.visual.size`.
 */
const TARGET_FOOTPRINT_PER_SIZE = 1.5;

/**
 * Corrective rotation applied to the raw glTF hierarchy so the model faces
 * the engine's forward axis (+Z) with +Y up.
 *
 * Authoring convention (Blender): mesh forward = −Y, up = +Z, export with
 * "+Y Up" checked. That maps to engine +Z forward / +Y up with no extra
 * rotation — leave this at identity unless a future re-export breaks it.
 */
const MODEL_ROTATION_CORRECTION = new THREE.Euler(0, 0, 0);

/**
 * `userData` flag marking geometry that is shared between every model instance
 * (three.js `Object3D.clone()` copies geometry/material *references*). Disposing
 * such geometry would blank out every other unit built from the same model.
 */
const SHARED_GEOMETRY_FLAG = 'sharedModelGeometry';

/** True if `geometry` is owned by the cached model and must not be disposed. */
export function isSharedModelGeometry(
  geometry: THREE.BufferGeometry | undefined
): boolean {
  return geometry?.userData[SHARED_GEOMETRY_FLAG] === true;
}

let textureAnisotropy = 1;

/**
 * Raise texture filtering quality using the renderer's max anisotropy.
 * Call once the WebGLRenderer exists (anisotropy defaults to 1 otherwise,
 * which makes flat/oblique surfaces look muddy — especially in Firefox).
 */
export function setPlasmaTankTextureAnisotropy(maxAnisotropy: number): void {
  textureAnisotropy = Math.max(1, maxAnisotropy);
  if (!assetManager.isReady()) return;
  applyTextureQuality(assetManager.getModel(MODEL_KEYS.plasmaTank));
}

function applyTextureQuality(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      for (const map of [
        material.map,
        material.metalnessMap,
        material.roughnessMap,
        material.normalMap,
        material.emissiveMap,
        material.aoMap,
      ]) {
        if (!map) continue;
        map.anisotropy = textureAnisotropy;
        map.needsUpdate = true;
      }
    }
  });
}

/**
 * Clones the cached Plasma Tank model, normalizes it to a horizontal footprint
 * matching `size`, and centers it on its own origin (consistent with the
 * centered procedural geometries used by other units). Requires
 * `assetManager.preloadAll()` to have resolved first (see `main.ts`); throws
 * otherwise.
 */
export function createPlasmaTankModelInstance(size: number): THREE.Object3D {
  const cachedModel = assetManager.getModel(MODEL_KEYS.plasmaTank);

  const instance = cachedModel.clone(true);
  instance.rotation.copy(MODEL_ROTATION_CORRECTION);
  instance.updateMatrixWorld(true);

  const rawSize = new THREE.Box3()
    .setFromObject(instance)
    .getSize(new THREE.Vector3());
  const footprint = Math.max(rawSize.x, rawSize.z) || 1;
  instance.scale.setScalar((size * TARGET_FOOTPRINT_PER_SIZE) / footprint);
  instance.updateMatrixWorld(true);

  const center = new THREE.Box3()
    .setFromObject(instance)
    .getCenter(new THREE.Vector3());
  instance.position.sub(center);

  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    // `clone()` shares materials with the cached model, so any per-instance
    // tweak (e.g. the translucent formation ghost/preview) would leak into
    // every other Plasma Tank on the field. Give each instance its own copies.
    // Textures stay shared, which is what we want for memory/anisotropy.
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
    // Geometry stays shared; flag it so teardown helpers leave it alone.
    if (child.geometry) child.geometry.userData[SHARED_GEOMETRY_FLAG] = true;
  });

  return instance;
}
