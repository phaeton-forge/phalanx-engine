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
    case 'plasmaTank':
      return createPlasmaTankBody(spec.size, teamId, unitType);
    case 'sau':
      return createSauBody(spec.size, teamId, unitType);
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
 * Plasma Tank visual: compact gun platform.
 * - Rectangular box fuselage, long axis along +Z (forward).
 * - A turret on top: cylinder base, a small box housing sized to sit on the
 *   base, and a thin forward-pointing barrel seated into the housing face.
 *   Barrel tip local Z = housingHalfDepth + barrelLength - embed = size * 0.99
 *   for the defaults below; MachineGunFireCue must stay in sync.
 */
function createPlasmaTankBody(
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

  const turretMaterial = new THREE.MeshStandardMaterial({
    color: resolveUnitColor(teamId, unitType),
    metalness: 0.5,
    roughness: 0.4,
  });

  const turretY = size * 0.55;
  const housingDepth = size * 0.45;
  const housingHalfDepth = housingDepth * 0.5;
  const barrelLength = size * 0.9;
  const barrelHalfLength = barrelLength * 0.5;
  // Seat ~15% of the barrel inside the housing so it clearly stems from it.
  const barrelEmbed = barrelLength * 0.15;
  const barrelCenterZ = housingHalfDepth + barrelHalfLength - barrelEmbed;

  const turretBase = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.35, size * 0.4, size * 0.25, 16),
    turretMaterial
  );
  turretBase.position.y = size * 0.3;
  enableShadows(turretBase);
  root.add(turretBase);

  // Housing footprint fits inside the base's top radius (0.35).
  const turretHousing = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.4, size * 0.25, housingDepth),
    turretMaterial
  );
  turretHousing.position.y = turretY;
  enableShadows(turretHousing);
  root.add(turretHousing);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.06, size * 0.06, barrelLength, 12),
    turretMaterial
  );
  barrel.rotation.x = Math.PI / 2; // point along +Z
  barrel.position.set(0, turretY, barrelCenterZ);
  enableShadows(barrel);
  root.add(barrel);

  return root;
}

/**
 * SAU (self-propelled artillery) visual: a hover artillery tank.
 *
 * Ported from the finalized concept: a hovering platform + layered hull with a
 * rounded bow, a boxy turret, and a long elevated barrel. The model is authored
 * with its long axis along local +X and its barrel toward +X; the inner model is
 * yawed -90° so the barrel points +Z (the engine's forward axis, matching the
 * other units and `SauMuzzleFlashCue`'s muzzle offset). Root rotation stays
 * available for team facing. `size` scales the whole assembly (size 3.8
 * reproduces the concept's 1.3× scale).
 */
function createSauBody(
  size: number,
  teamId: TeamId,
  unitType: UnitType
): THREE.Object3D {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);

  const hullMat = createTeamMaterial(teamId, unitType);
  const hullLoMat = new THREE.MeshStandardMaterial({
    color: resolveUnitColor(teamId, unitType),
    roughness: 0.85,
    metalness: 0.15,
  });
  hullLoMat.color.multiplyScalar(0.7);
  const turretMat = createTeamMaterial(teamId, unitType);
  const gunMat = new THREE.MeshStandardMaterial({
    color: 0x35393d,
    roughness: 0.55,
    metalness: 0.45,
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d30,
    roughness: 0.7,
    metalness: 0.3,
  });
  const detailMat = new THREE.MeshStandardMaterial({
    color: resolveUnitColor(teamId, unitType),
    roughness: 0.8,
    metalness: 0.1,
  });
  detailMat.color.multiplyScalar(0.85);
  const platformMat = new THREE.MeshStandardMaterial({
    color: 0x2b3022,
    roughness: 0.6,
    metalness: 0.35,
  });

  const HOVER_Y = 1.15;

  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    castShadow = true
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (castShadow) mesh.castShadow = true;
    model.add(mesh);
    return mesh;
  };

  // Hover platform + skirt.
  add(new THREE.BoxGeometry(4.5, 0.34, 2.05), platformMat, -0.1, 0.66, 0);
  add(new THREE.BoxGeometry(4.5, 0.2, 2.05), darkMat, -0.1, HOVER_Y - 0.4, 0, false);

  // Hull stack.
  add(new THREE.BoxGeometry(4.4, 1.0, 1.95), hullLoMat, -0.1, HOVER_Y, 0);
  const bow = add(
    new THREE.CylinderGeometry(0.5, 0.5, 1.95, 24),
    hullLoMat,
    2.1,
    HOVER_Y,
    0
  );
  bow.rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(4.1, 0.55, 1.78), hullMat, -0.1, HOVER_Y + 0.62, 0);
  add(new THREE.BoxGeometry(0.9, 0.6, 1.6), detailMat, -2.05, HOVER_Y + 0.6, 0);

  // Turret.
  add(new THREE.BoxGeometry(2.4, 0.78, 1.8), turretMat, -0.25, HOVER_Y + 1.27, 0);
  add(new THREE.BoxGeometry(2.0, 0.12, 1.45), detailMat, -0.25, HOVER_Y + 1.7, 0);
  const cupola = add(
    new THREE.CylinderGeometry(0.3, 0.32, 0.34, 16),
    detailMat,
    0,
    HOVER_Y + 1.92,
    -0.45
  );
  cupola.castShadow = true;
  add(
    new THREE.CylinderGeometry(0.23, 0.23, 0.08, 16),
    darkMat,
    -0.95,
    HOVER_Y + 1.74,
    0.45,
    false
  );
  add(new THREE.BoxGeometry(0.5, 0.62, 1.0), gunMat, 1.0, HOVER_Y + 1.22, 0);

  // Barrel assembly (elevated, along +X local).
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(1.1, HOVER_Y + 1.22, 0);
  barrelGroup.rotation.z = 0.28;
  model.add(barrelGroup);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.15, 5.6, 24),
    gunMat
  );
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.x = 2.8;
  barrel.castShadow = true;
  barrelGroup.add(barrel);
  const fume = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.55, 20),
    darkMat
  );
  fume.rotation.z = -Math.PI / 2;
  fume.position.x = 4.0;
  barrelGroup.add(fume);
  const muzzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.17, 0.55, 20),
    darkMat
  );
  muzzle.rotation.z = -Math.PI / 2;
  muzzle.position.x = 5.5;
  barrelGroup.add(muzzle);

  // Antenna + side exhaust.
  const antenna = add(
    new THREE.CylinderGeometry(0.022, 0.022, 1.7, 6),
    darkMat,
    -1.35,
    HOVER_Y + 2.45,
    0.55
  );
  antenna.castShadow = true;
  const exhaust = add(
    new THREE.CylinderGeometry(0.13, 0.13, 0.95, 12),
    darkMat,
    -2.4,
    HOVER_Y + 0.5,
    0.5,
    false
  );
  exhaust.rotation.z = Math.PI / 2;

  // Lower the assembly so its mass centers near the group origin, then yaw the
  // inner model so the barrel faces +Z. Keep root.rotation free for team facing
  // / combat turns (FormationGridRenderer and RotationSystem write root.yaw).
  // Scale to the requested size (3.8 → concept 1.3×).
  model.position.y = -HOVER_Y;
  model.rotation.y = -Math.PI / 2;
  root.scale.setScalar(size * 0.342);

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
