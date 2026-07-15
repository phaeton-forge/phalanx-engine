import * as THREE from 'three';
import { arenaParams } from '../config/constants';
import type { TeamId } from '../components';
import type { UnitDefinition } from './UnitDefinition';
import type { UnitType } from './UnitType';

/**
 * Resolve a unit's body color from its team's pastel palette, keyed by unit type.
 * Falls back to the team base color if a type is missing from the palette.
 * Team 0 -> cool palette, Team 1 -> warm palette.
 */
function resolveUnitColor(teamId: TeamId, unitType: UnitType): string {
  const palette =
    teamId === 0 ? arenaParams.team1Palette : arenaParams.team2Palette;
  const base = teamId === 0 ? arenaParams.team1Color : arenaParams.team2Color;
  return palette[unitType] ?? base;
}

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
  const root = createBody(def.visual, teamId, def.type);

  const {
    root: healthBarRoot,
    fill: healthBarFill,
    fullWidth: healthBarFullWidth,
  } = createHealthBar(teamId, def.type);

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
  teamId: TeamId,
  unitType: UnitType
): THREE.Object3D {
  switch (spec.shape) {
    case 'box':
      return createBoxBody(spec.size, teamId, unitType);
    case 'sphere':
      return createSphereBody(spec.size, teamId, unitType);
    case 'cone':
      // Cone geometry: radius, height → base sits on the ground at the support height offset.
      return createConeBody(spec.size, teamId, unitType);
    case 'octahedron':
      return createOctahedronBody(spec.size, teamId, unitType);
    case 'volt':
      return createVoltBody(spec.size, teamId, unitType);
    case 'drone':
      return createDroneBody(spec.size, teamId, unitType);
  }
}

function createTeamMaterial(
  teamId: TeamId,
  unitType: UnitType
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: resolveUnitColor(teamId, unitType),
    roughness: 0.35,
    metalness: 0.2,
  });
}

function enableShadows(mesh: THREE.Mesh): void {
  // Units only cast shadows; self-shadowing on low-poly shapes creates ugly artifacts.
  mesh.castShadow = true;
}

function createBoxBody(
  size: number,
  teamId: TeamId,
  unitType: UnitType
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    createTeamMaterial(teamId, unitType)
  );
  enableShadows(mesh);
  return mesh;
}

function createSphereBody(
  size: number,
  teamId: TeamId,
  unitType: UnitType
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 24, 16),
    createTeamMaterial(teamId, unitType)
  );
  enableShadows(mesh);
  return mesh;
}

function createConeBody(
  size: number,
  teamId: TeamId,
  unitType: UnitType
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(size, size * 2, 24),
    createTeamMaterial(teamId, unitType)
  );
  enableShadows(mesh);
  return mesh;
}

function createOctahedronBody(
  size: number,
  teamId: TeamId,
  unitType: UnitType
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(size),
    createTeamMaterial(teamId, unitType)
  );
  enableShadows(mesh);
  return mesh;
}

/**
 * Volt visual: floating electric caster.
 * - Octahedron core tinted by team color.
 * - Cyan/magenta emissive core glow.
 * - Hovering torus coil at the base.
 * - Small conductor orb on top where lightning originates.
 */
function createVoltBody(
  size: number,
  teamId: TeamId,
  unitType: UnitType
): THREE.Object3D {
  const root = new THREE.Group();

  const teamColor = resolveUnitColor(teamId, unitType);
  // Softened pastel emissive to match the "Малышарики" palette
  // (was harsh cyan 0x00ffff / magenta 0xff00ff).
  const coreColor = teamId === 0 ? 0x9de5ff : 0xffc2c2;

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
  enableShadows(core);
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
  enableShadows(coil);
  root.add(coil);

  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(size * 0.22, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  orb.position.y = size * 1.55;
  root.add(orb);

  return root;
}

/**
 * Drone visual: gunship silhouette.
 * - Rectangular box fuselage, long axis along +Z (forward).
 * - Two mirrored wedge wings (thin triangular prisms) jutting outward along X.
 * - A turret on top: cylinder base, box housing, thin forward-pointing barrel.
 *   The barrel tip sits at ~local (0, size * 0.55, size * 0.9); the fire cue
 *   uses a matching constant muzzle offset.
 */
function createDroneBody(
  size: number,
  teamId: TeamId,
  unitType: UnitType
): THREE.Object3D {
  const root = new THREE.Group();

  const fuselage = new THREE.Mesh(
    new THREE.BoxGeometry(size, size * 0.5, size * 1.5),
    createTeamMaterial(teamId, unitType)
  );
  enableShadows(fuselage);
  root.add(fuselage);

  // Wedge wing: triangle in the XZ-like plane, extruded thinly along Z.
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, -size * 0.55); // chord rear, against the hull
  wingShape.lineTo(0, size * 0.55); // chord front, against the hull
  wingShape.lineTo(size * 0.9, 0); // apex pointing outward
  wingShape.closePath();
  const wingGeometry = new THREE.ExtrudeGeometry(wingShape, {
    depth: size * 0.15,
    bevelEnabled: false,
  });
  const wingMaterial = createTeamMaterial(teamId, unitType);

  const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
  rightWing.position.set(size / 2, 0, -size * 0.075);
  enableShadows(rightWing);
  root.add(rightWing);

  const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
  leftWing.position.set(-size / 2, 0, -size * 0.075);
  leftWing.scale.x = -1;
  enableShadows(leftWing);
  root.add(leftWing);

  const turretMaterial = new THREE.MeshStandardMaterial({
    color: resolveUnitColor(teamId, unitType),
    metalness: 0.5,
    roughness: 0.4,
  });

  const turretBase = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.35, size * 0.4, size * 0.25, 16),
    turretMaterial
  );
  turretBase.position.y = size * 0.3;
  enableShadows(turretBase);
  root.add(turretBase);

  const turretHousing = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.5, size * 0.3, size * 0.6),
    turretMaterial
  );
  turretHousing.position.y = size * 0.55;
  enableShadows(turretHousing);
  root.add(turretHousing);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.06, size * 0.06, size * 0.9, 12),
    turretMaterial
  );
  barrel.rotation.x = Math.PI / 2; // point along +Z
  barrel.position.set(0, size * 0.55, size * 0.9);
  enableShadows(barrel);
  root.add(barrel);

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

function createHealthBar(
  teamId: TeamId,
  unitType: UnitType
): {
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
      color: resolveUnitColor(teamId, unitType),
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
