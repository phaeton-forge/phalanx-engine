import * as THREE from 'three';
import {
  BOARD_SIZE,
  CELL_SIZE,
  BOARD_EXTENT,
  BOARD_HEIGHT,
  BOARD_RIM_WIDTH,
  BOARD_ROUGHNESS,
  BOARD_METALNESS,
  BOARD_FRAME_COLOR,
  BOARD_SQUARE_ROUGHNESS,
  BOARD_SQUARE_METALNESS,
  BOARD_ENV_MAP_INTENSITY,
  LIGHT_SQUARE_COLOR,
  DARK_SQUARE_COLOR,
} from '../config/constants.ts';

/**
 * Creates the board mesh group: a base box + 64 square tiles on top.
 * Textures are loaded from `textures/deck/` and `textures/boards/`.
 */
export function createBoardMesh(): THREE.Group {
  const group = new THREE.Group();

  const textureLoader = new THREE.TextureLoader();

  // ── Deck (frame / base) ──────────────────────────────────────
  const deckColorTex = textureLoader.load('/textures/deck/Wood028_1K-JPG_Color.jpg');
  deckColorTex.colorSpace = THREE.SRGBColorSpace;
  const deckNormalTex = textureLoader.load('/textures/deck/Wood028_1K-JPG_NormalGL.jpg');
  const deckRoughTex = textureLoader.load('/textures/deck/Wood028_1K-JPG_Roughness.jpg');

  setRepeat(deckColorTex, 2, 2);
  setRepeat(deckNormalTex, 2, 2);
  setRepeat(deckRoughTex, 2, 2);

  const deckMat = new THREE.MeshStandardMaterial({
    map: deckColorTex,
    normalMap: deckNormalTex,
    roughnessMap: deckRoughTex,
    roughness: BOARD_ROUGHNESS,
    metalness: BOARD_METALNESS,
    envMapIntensity: BOARD_ENV_MAP_INTENSITY,
    color: new THREE.Color(BOARD_FRAME_COLOR),
  });

  const rimTotal = BOARD_EXTENT + BOARD_RIM_WIDTH * 2;
  const deckGeo = new THREE.BoxGeometry(rimTotal, BOARD_HEIGHT, rimTotal);
  const deckMesh = new THREE.Mesh(deckGeo, deckMat);
  deckMesh.position.y = 0;
  deckMesh.receiveShadow = true;
  deckMesh.castShadow = true;
  group.add(deckMesh);

  // ── Board squares ────────────────────────────────────────────
  const boardTex = textureLoader.load('/textures/boards/Wood076_1K-JPG_Color.jpg');
  boardTex.colorSpace = THREE.SRGBColorSpace;
  const boardNormal = textureLoader.load('/textures/boards/Wood076_1K-JPG_NormalGL.jpg');
  const boardRough = textureLoader.load('/textures/boards/Wood076_1K-JPG_Roughness.jpg');

  const squareGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.98, CELL_SIZE * 0.98);

  const half = (BOARD_SIZE - 1) / 2;
  const yTop = BOARD_HEIGHT / 2 + 0.001; // slightly above the deck surface

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const isDark = (row + col) % 2 === 1;

      const squareMat = new THREE.MeshStandardMaterial({
        map: boardTex,
        normalMap: boardNormal,
        roughnessMap: boardRough,
        roughness: BOARD_SQUARE_ROUGHNESS,
        metalness: BOARD_SQUARE_METALNESS,
        envMapIntensity: BOARD_ENV_MAP_INTENSITY,
        color: new THREE.Color(isDark ? DARK_SQUARE_COLOR : LIGHT_SQUARE_COLOR),
      });


      const mesh = new THREE.Mesh(squareGeo, squareMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(
        (col - half) * CELL_SIZE,
        yTop,
        (row - half) * CELL_SIZE,
      );
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  return group;
}

// ── Helpers ──────────────────────────────────────────────────────

function setRepeat(tex: THREE.Texture, u: number, v: number): void {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(u, v);
}

