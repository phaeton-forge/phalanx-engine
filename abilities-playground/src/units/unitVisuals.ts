import * as THREE from 'three';
import { arenaParams } from '../config/constants';
import type { TeamId } from '../components';
import type { UnitDefinition } from './UnitDefinition';

export interface UnitRenderRefs {
  root: THREE.Object3D;
  healthBarRoot: THREE.Object3D;
  healthBarFill: THREE.Object3D;
  healthBarFullWidth: number;
  detectionRing?: THREE.Mesh;
  spawnPoint?: { marker: THREE.Object3D };
  auraRing?: THREE.Mesh;
}

/** Build body + decorations from the view spec (data-driven). */
export function createUnitRenderRefs(
  _scene: THREE.Scene,
  def: UnitDefinition,
  teamId: TeamId,
): UnitRenderRefs {
  const root = createBody(def.visual, teamId);

  const { root: healthBarRoot, fill: healthBarFill, fullWidth: healthBarFullWidth } =
    createHealthBar(teamId);

  let spawnPoint: { marker: THREE.Object3D } | undefined;
  if (def.visual.hasSpawnArrow) {
    spawnPoint = createSphereSpawnPoint();
    root.add(spawnPoint.marker);
  }

  let auraRing: THREE.Mesh | undefined;
  if (def.visual.hasAuraRing && def.aura) {
    auraRing = createAuraRing(def.aura.radius);
  }

  return {
    root,
    healthBarRoot,
    healthBarFill,
    healthBarFullWidth,
    spawnPoint,
    auraRing,
  };
}

/** Body mesh only — `switch (def.visual.shape)` lives here (sphere/box/cone/octahedron). */
function createBody(spec: UnitDefinition['visual'], teamId: TeamId): THREE.Mesh {
  const material = new THREE.MeshStandardMaterial({
    color: teamId === 0 ? arenaParams.team1Color : arenaParams.team2Color,
    roughness: 0.55,
    metalness: 0.05,
  });

  switch (spec.shape) {
    case 'box':
      return new THREE.Mesh(new THREE.BoxGeometry(spec.size, spec.size, spec.size), material);
    case 'sphere':
      return new THREE.Mesh(new THREE.SphereGeometry(spec.size, 24, 16), material);
    case 'cone':
      // Cone geometry: radius, height → base sits on the ground at the support height offset.
      return new THREE.Mesh(new THREE.ConeGeometry(spec.size, spec.size * 2, 24), material);
    case 'octahedron':
      return new THREE.Mesh(new THREE.OctahedronGeometry(spec.size), material);
  }
}

/** Thin green ring sized to the healing-aura radius; permanent aura indicator. */
function createAuraRing(radius: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    // Inner radius 0.98 → half the previous ring thickness (was 0.96–1.0).
    new THREE.RingGeometry(0.98, 1, 96),
    new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  // World Y is pinned to the ground by RenderSyncSystem; this is just a default.
  ring.position.y = 0.06;
  ring.renderOrder = 2;
  ring.scale.set(radius, radius, 1);
  return ring;
}

function createHealthBar(teamId: TeamId): {
  root: THREE.Object3D;
  fill: THREE.Object3D;
  fullWidth: number;
} {
  const healthBarRoot = new THREE.Group();
  const healthBarFullWidth = 6;
  const background = new THREE.Mesh(
    new THREE.BoxGeometry(healthBarFullWidth, 0.35, 0.25),
    new THREE.MeshBasicMaterial({ color: 0x1f1f1f }),
  );
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(healthBarFullWidth, 0.4, 0.3),
    new THREE.MeshBasicMaterial({
      color: teamId === 0 ? arenaParams.team1Color : arenaParams.team2Color,
    }),
  );

  fill.position.z = -0.02;
  healthBarRoot.add(background);
  healthBarRoot.add(fill);

  return { root: healthBarRoot, fill, fullWidth: healthBarFullWidth };
}

function createSphereSpawnPoint(): { marker: THREE.Object3D } {
  const SPHERE_VISUAL_RADIUS = 2;
  const FORWARD_OFFSET = 1.0;
  const offsetZ = SPHERE_VISUAL_RADIUS + FORWARD_OFFSET;

  const marker = new THREE.Object3D();
  marker.position.set(0, 0, offsetZ);

  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, 0),
    1.5,
    0xffff00,
    0.4,
    0.25,
  );
  marker.add(arrow);

  return { marker };
}
