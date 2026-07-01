import * as THREE from 'three';
import {
  CHECKER_RADIUS,
  CHECKER_HEIGHT,
  CHECKER_SEGMENTS,
  CHECKER_BEVEL_RADIUS,
  CHECKER_BEVEL_SEGMENTS,
  WHITE_CHECKER_ROUGHNESS,
  WHITE_CHECKER_METALNESS,
  WHITE_CHECKER_COLOR,
  WHITE_CHECKER_ENV_MAP_INTENSITY,
  BLACK_CHECKER_ROUGHNESS,
  BLACK_CHECKER_METALNESS,
  BLACK_CHECKER_COLOR,
  BLACK_CHECKER_ENV_MAP_INTENSITY,
} from '../config/constants.ts';
import { TeamTag } from '../enums/TeamTag.ts';
import { assetManager } from './AssetManager.ts';
import {
  BRIGHT_CHECKER_TEXTURES,
  DARK_CHECKER_TEXTURES,
} from './AssetManifest.ts';

/** Shared geometry – created once and reused for every checker */
let sharedGeometry: THREE.LatheGeometry | null = null;

/**
 * Build a beveled checker profile and revolve it with LatheGeometry.
 * The profile is a cross-section from center (x=0) outward:
 *
 *   center-bottom → outer-bottom-bevel → straight side →
 *   outer-top-bevel → center-top
 *
 * LatheGeometry revolves around the Y axis.
 */
function getCheckerGeometry(): THREE.LatheGeometry {
  if (sharedGeometry) return sharedGeometry;

  const r = CHECKER_RADIUS;
  const halfH = CHECKER_HEIGHT / 2;
  const bR = CHECKER_BEVEL_RADIUS;
  const bS = CHECKER_BEVEL_SEGMENTS;

  const points: THREE.Vector2[] = [];

  // 1. Center of bottom face → outward to where bevel begins
  points.push(new THREE.Vector2(0, -halfH));
  points.push(new THREE.Vector2(r - bR, -halfH));

  // 2. Bottom-edge bevel arc (quarter circle, curving from bottom face to side)
  for (let i = 0; i <= bS; i++) {
    const angle = (Math.PI / 2) * (i / bS); // 0 → π/2
    const x = r - bR + Math.sin(angle) * bR;
    const y = -halfH + bR - Math.cos(angle) * bR;
    points.push(new THREE.Vector2(x, y));
  }

  // 3. Top-edge bevel arc (quarter circle, curving from side to top face)
  for (let i = 0; i <= bS; i++) {
    const angle = (Math.PI / 2) * (i / bS); // 0 → π/2
    const x = r - bR + Math.cos(angle) * bR;
    const y = halfH - bR + Math.sin(angle) * bR;
    points.push(new THREE.Vector2(x, y));
  }

  // 4. Top face back to center
  points.push(new THREE.Vector2(r - bR, halfH));
  points.push(new THREE.Vector2(0, halfH));

  sharedGeometry = new THREE.LatheGeometry(points, CHECKER_SEGMENTS);
  return sharedGeometry;
}

/** Cached materials per team – avoids recreating per checker */
const materialCache = new Map<TeamTag, THREE.MeshStandardMaterial>();

function getCheckerMaterial(team: TeamTag): THREE.MeshStandardMaterial {
  const cached = materialCache.get(team);
  if (cached) return cached;

  if (team === TeamTag.White) {
    const colorTex = assetManager.getTexture(BRIGHT_CHECKER_TEXTURES.color);
    colorTex.colorSpace = THREE.SRGBColorSpace;
    const normalTex = assetManager.getTexture(BRIGHT_CHECKER_TEXTURES.normal);
    const roughTex = assetManager.getTexture(BRIGHT_CHECKER_TEXTURES.roughness);

    const mat = new THREE.MeshStandardMaterial({
      map: colorTex,
      normalMap: normalTex,
      roughnessMap: roughTex,
      roughness: WHITE_CHECKER_ROUGHNESS,
      metalness: WHITE_CHECKER_METALNESS,
      color: new THREE.Color(WHITE_CHECKER_COLOR),
      envMapIntensity: WHITE_CHECKER_ENV_MAP_INTENSITY,
    });
    materialCache.set(team, mat);
    return mat;
  }

  // Black
  const colorTex = assetManager.getTexture(DARK_CHECKER_TEXTURES.color);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  const normalTex = assetManager.getTexture(DARK_CHECKER_TEXTURES.normal);
  const roughTex = assetManager.getTexture(DARK_CHECKER_TEXTURES.roughness);

  const mat = new THREE.MeshStandardMaterial({
    map: colorTex,
    normalMap: normalTex,
    roughnessMap: roughTex,
    roughness: BLACK_CHECKER_ROUGHNESS,
    metalness: BLACK_CHECKER_METALNESS,
    color: new THREE.Color(BLACK_CHECKER_COLOR),
    envMapIntensity: BLACK_CHECKER_ENV_MAP_INTENSITY,
  });
  materialCache.set(team, mat);
  return mat;
}

/**
 * Creates a single checker mesh for the given team.
 * The mesh is positioned at the origin – the caller must set position.
 */
export function createCheckerMesh(team: TeamTag): THREE.Mesh {
  const geometry = getCheckerGeometry();
  const material = getCheckerMaterial(team);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
