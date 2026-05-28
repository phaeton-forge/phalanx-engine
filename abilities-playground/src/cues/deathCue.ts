import * as THREE from 'three';
import { FPVector3 } from 'phalanx-math';
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

function easeOutExpo(t: number): number {
  const x = clamp01(t);
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

function createDeathExplosionVfx(position: THREE.Vector3): ActiveVfx {
  const particleCount = 240;
  const positions = new Float32Array(particleCount * 3);

  for (let i = 0; i < particleCount; i++) {
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
    positions[idx + 1] = y * 0.8; // slightly flatter vertically
    positions[idx + 2] = z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: new THREE.Color('#ffb02e'),
    size: 1.45,
    sizeAttenuation: true,
    transparent: true,
    opacity: 1.0,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.position.copy(position);
  points.frustumCulled = false;
  points.renderOrder = 10_000;

  const duration = 0.65;
  const startScale = 0.35;
  const endScale = 3.2;
  points.scale.setScalar(startScale);

  return {
    obj: points,
    elapsed: 0,
    duration,
    update: (t: number) => {
      const k = easeOutExpo(t);
      points.scale.setScalar(startScale + (endScale - startScale) * k);
      material.opacity = 1.0 * (1 - clamp01(t));
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function tryGetDeathPosition(world: GameWorld, e: GameplayCueDispatchedEvent): THREE.Vector3 | null {
  const entity = world.entityManager.getEntity(e.targetEntityId);
  if (!entity) return null;
  const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
  if (!transform) return null;
  const p = FPVector3.ToFloat(transform.fpPosition);
  return new THREE.Vector3(p.x, p.y, p.z);
}

export function deathCue(
  scene: THREE.Scene,
  world: GameWorld,
  e: GameplayCueDispatchedEvent,
  activeVfx: ActiveVfx[],
): void {
  const pos = tryGetDeathPosition(world, e);
  if (!pos) return;

  const vfx = createDeathExplosionVfx(pos);
  activeVfx.push(vfx);
  scene.add(vfx.obj);
}

