import * as THREE from 'three';
import { FPVector3 } from 'phalanx-math';
import { FP } from 'phalanx-math';
import { PhysicsSoASchema } from 'phalanx-physics';
import type { GameWorld } from 'phalanx-ecs';
import type { GameplayCueDispatchedEvent } from 'phalanx-abilities';
import { ComponentType, TransformComponent } from '../components';

type ActiveVfx = {
  obj: THREE.Object3D;
  elapsed: number;
  duration: number;
  update: (t: number) => void;
  dispose: () => void;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

function createDamageBurstVfx(position: THREE.Vector3): ActiveVfx {
  const particleCount = 90;
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
    // Random points within unit sphere (rejection sampling).
    let x = 0;
    let y = 0;
    let z = 0;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
    } while (x * x + y * y + z * z > 1);

    const idx = i * 3;
    positions[idx + 0] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: new THREE.Color('#ff5a3d'),
    size: 0.85,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.position.copy(position);
  points.frustumCulled = false;
  points.renderOrder = 10_000;

  const duration = 0.35;
  const startScale = 0.25;
  const endScale = 1.6;
  points.scale.setScalar(startScale);

  return {
    obj: points,
    elapsed: 0,
    duration,
    update: (t: number) => {
      const k = easeOutCubic(t);
      const s = startScale + (endScale - startScale) * k;
      points.scale.setScalar(s);
      material.opacity = 0.95 * (1 - k);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function tryGetImpactPointFromEntities(world: GameWorld, e: GameplayCueDispatchedEvent): THREE.Vector3 | null {
  const em = world.entityManager;
  const source = em.getEntity(e.sourceEntityId);
  const target = em.getEntity(e.targetEntityId);
  if (!source || !target) return null;

  const sourceTransform = source.getComponent<TransformComponent>(ComponentType.Transform);
  const targetTransform = target.getComponent<TransformComponent>(ComponentType.Transform);
  if (!sourceTransform || !targetTransform) return null;

  const src = FPVector3.ToFloat(sourceTransform.fpPosition);
  const tgt = FPVector3.ToFloat(targetTransform.fpPosition);

  const physStore = em.getOrCreateSoAStore(PhysicsSoASchema);
  const physIdx = physStore.indexOf(target.id);
  const targetRadius =
    physIdx === -1 ? 1 : FP.ToFloat(FP.FromRaw(physStore.arrays.radius[physIdx]));

  const normal = new THREE.Vector3(src.x - tgt.x, src.y - tgt.y, src.z - tgt.z);
  const lenSq = normal.lengthSq();
  if (lenSq < 1e-8) return new THREE.Vector3(tgt.x, tgt.y, tgt.z);
  normal.multiplyScalar(1 / Math.sqrt(lenSq));

  // Point slightly outside the target surface towards the projectile.
  // This avoids the VFX being fully occluded when the impact point is "inside" the mesh.
  return new THREE.Vector3(tgt.x, tgt.y, tgt.z).addScaledVector(normal, targetRadius * 1.05 + 0.05);
}

export function damageSphereCue(
  scene: THREE.Scene,
  world: GameWorld,
  e: GameplayCueDispatchedEvent,
  activeVfx: ActiveVfx[],
): void {
  const impact = tryGetImpactPointFromEntities(world, e);
  if (!impact) return;

  const vfx = createDamageBurstVfx(impact);
  activeVfx.push(vfx);
  scene.add(vfx.obj);
}

export function updateCueVfx(scene: THREE.Scene, activeVfx: ActiveVfx[], dtSeconds: number): void {
  for (let i = activeVfx.length - 1; i >= 0; i--) {
    const vfx = activeVfx[i];
    vfx.elapsed += dtSeconds;
    const t = vfx.duration <= 0 ? 1 : vfx.elapsed / vfx.duration;
    vfx.update(t);
    if (t >= 1) {
      scene.remove(vfx.obj);
      vfx.dispose();
      activeVfx.splice(i, 1);
    }
  }
}

