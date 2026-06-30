import * as THREE from 'three';
import { getTeamColor } from '../config/constants';
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
  teamId: TeamId
): UnitRenderRefs {
  const root = createBody(def.visual, teamId);

  const {
    root: healthBarRoot,
    fill: healthBarFill,
    fullWidth: healthBarFullWidth,
  } = createHealthBar(teamId);

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

/** Body mesh only — `switch (def.visual.shape)` lives here (sphere/box/cone/octahedron/volt). */
function createBody(
  spec: UnitDefinition['visual'],
  teamId: TeamId
): THREE.Object3D {
  switch (spec.shape) {
    case 'box':
      return createBoxBody(spec.size, teamId);
    case 'sphere':
      return createSphereBody(spec.size, teamId);
    case 'cone':
      // Cone geometry: radius, height → base sits on the ground at the support height offset.
      return createConeBody(spec.size, teamId);
    case 'octahedron':
      return createOctahedronBody(spec.size, teamId);
    case 'volt':
      return createVoltBody(spec.size, teamId);
  }
}

function createTeamMaterial(teamId: TeamId): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: getTeamColor(teamId, 'primary'),
    roughness: 0.55,
    metalness: 0.05,
  });
}

function createBoxBody(size: number, teamId: TeamId): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    createTeamMaterial(teamId)
  );
}

function createSphereBody(size: number, teamId: TeamId): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.SphereGeometry(size, 24, 16),
    createTeamMaterial(teamId)
  );
}

function createConeBody(size: number, teamId: TeamId): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.ConeGeometry(size, size * 2, 24),
    createTeamMaterial(teamId)
  );
}

function createOctahedronBody(size: number, teamId: TeamId): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.OctahedronGeometry(size),
    createTeamMaterial(teamId)
  );
}

/**
 * Volt visual: floating electric caster.
 * - Octahedron core tinted by team color.
 * - Cyan/magenta emissive core glow.
 * - Hovering torus coil at the base.
 * - Small conductor orb on top where lightning originates.
 */
function createVoltBody(size: number, teamId: TeamId): THREE.Object3D {
  const root = new THREE.Group();

  const teamColor = getTeamColor(teamId, 'primary');
  const coreColor = getTeamColor(teamId, 'glow');

  const core = new THREE.Mesh(
    new THREE.OctahedronGeometry(size, 0),
    new THREE.MeshStandardMaterial({
      color: teamColor,
      emissive: coreColor,
      emissiveIntensity: 0.35,
      roughness: 0.35,
      metalness: 0.25,
    })
  );
  core.position.y = size * 0.85;
  root.add(core);

  const coil = new THREE.Mesh(
    new THREE.TorusGeometry(size * 0.55, size * 0.08, 12, 32),
    new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: coreColor,
      emissiveIntensity: 0.5,
      roughness: 0.3,
      metalness: 0.4,
    })
  );
  coil.rotation.x = Math.PI / 2;
  coil.position.y = size * 0.2;
  root.add(coil);

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.22, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  orb.position.y = size * 1.55;
  root.add(orb);

  return root;
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
    })
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
    new THREE.MeshBasicMaterial({ color: 0x1f1f1f })
  );
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(healthBarFullWidth, 0.4, 0.3),
    new THREE.MeshBasicMaterial({
      color: getTeamColor(teamId, 'primary'),
    })
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
    0.25
  );
  marker.add(arrow);

  return { marker };
}
