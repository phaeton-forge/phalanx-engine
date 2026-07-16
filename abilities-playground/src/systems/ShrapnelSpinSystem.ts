import { GameSystem } from '@phalanx-engine/ecs';
import * as THREE from 'three';
import { ComponentType, MeshComponent } from '../components';

/** Angular speed range (rad/s) for a fragment's cosmetic tumble. */
const SPIN_SPEED_MIN = 6;
const SPIN_SPEED_MAX = 14;

/** Emissive-glow pulse (the "armed / about to blow" flicker) tuning. */
const GLOW_BASE = 1.4;
const GLOW_AMPLITUDE = 1.1;
const GLOW_PULSE_HZ = 6;

/**
 * ShrapnelSpinSystem — purely cosmetic tumbling for SAU shrapnel fragments.
 *
 * Frame system (not a tick system): it spins the shard mesh INSIDE the
 * MeshComponent root, never touching TransformComponent or the physics store,
 * so it cannot affect the deterministic simulation. RenderSyncSystem owns the
 * root's position/quaternion; this system only rotates the child shard.
 *
 * Uses Math.random deliberately — spin is visual-only and is allowed to differ
 * between clients without breaking lockstep.
 */
export class ShrapnelSpinSystem extends GameSystem {
  /** Per-fragment angular velocity (rad/s), assigned on first sight. */
  private readonly spins = new Map<number, THREE.Vector3>();

  /** Accumulated time (s) driving the shared emissive pulse. */
  private elapsed = 0;

  public override update(deltaTime: number): void {
    const fragments = this.entityManager.queryEntities(
      ComponentType.ShrapnelPayload,
      ComponentType.Mesh
    );

    // Pulse the shared incendiary material once per frame (all fragments glow
    // in unison — cheap and reads as "armed"). Only while fragments exist.
    if (fragments.length > 0) {
      this.elapsed += deltaTime;
      const material = MeshComponent.getShrapnelMaterial();
      if (material) {
        const pulse = Math.sin(this.elapsed * GLOW_PULSE_HZ * Math.PI * 2);
        material.emissiveIntensity = GLOW_BASE + GLOW_AMPLITUDE * pulse;
      }
    }

    const alive = new Set<number>();

    for (const entity of fragments) {
      alive.add(entity.id);

      const mesh = entity.getComponent<MeshComponent>(ComponentType.Mesh);
      const shard = mesh?.root.children[0];
      if (!shard) continue;

      let spin = this.spins.get(entity.id);
      if (!spin) {
        spin = this.randomAngularVelocity();
        this.spins.set(entity.id, spin);
        // Random initial attitude so simultaneous fragments don't tumble in sync.
        shard.rotation.set(
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2
        );
      }

      shard.rotation.x += spin.x * deltaTime;
      shard.rotation.y += spin.y * deltaTime;
      shard.rotation.z += spin.z * deltaTime;
    }

    // Fragments returned to the pool leave the query; drop their spin state so
    // a pooled respawn (same entity id) rolls a fresh tumble.
    for (const id of this.spins.keys()) {
      if (!alive.has(id)) this.spins.delete(id);
    }
  }

  private randomAngularVelocity(): THREE.Vector3 {
    const speed =
      SPIN_SPEED_MIN + Math.random() * (SPIN_SPEED_MAX - SPIN_SPEED_MIN);
    const axis = new THREE.Vector3(
      Math.random() * 2 - 1,
      Math.random() * 2 - 1,
      Math.random() * 2 - 1
    );
    // Degenerate near-zero axis: fall back to a plain Y tumble.
    if (axis.lengthSq() < 1e-6) axis.set(0, 1, 0);
    return axis.normalize().multiplyScalar(speed);
  }
}
