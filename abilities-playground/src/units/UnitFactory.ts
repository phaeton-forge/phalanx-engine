import * as THREE from 'three';
import { type Entity, type GameWorld } from '@phalanx-engine/ecs';
import { FP, FPQuaternion } from '@phalanx-engine/math';
import { AbilityOwner } from '@phalanx-engine/abilities';
import type { TeamId } from '../components';
import { UNIT_DEFINITIONS } from './unitDefinitions';
import { assembleUnit } from './unitAssembler';
import { createUnitRenderRefs, type UnitRenderRefs } from './unitVisuals';
import type { UnitType } from './UnitType';
import type { UnitDefinition } from './UnitDefinition';

export class UnitFactory {
  private readonly scene: THREE.Scene;
  private readonly world: GameWorld;

  constructor(scene: THREE.Scene, world: GameWorld) {
    this.scene = scene;
    this.world = world;
  }

  /** Full deterministic battle entity, registered on this world. */
  spawnBattleUnit(
    type: UnitType,
    teamId: TeamId,
    pos: { x: number; y: number; z: number }
  ): Entity {
    const def = UNIT_DEFINITIONS[type];
    const refs = createUnitRenderRefs(this.scene, def, teamId);
    this.scene.add(refs.healthBarRoot);

    // Aura ring lives in world space (RenderSyncSystem positions it each frame)
    // so it never inherits the body's combat re-orientation.
    if (refs.auraRing) this.scene.add(refs.auraRing);

    const entity = this.world.createEntity();
    assembleUnit(entity, def, teamId, pos, refs);

    refs.root.position.set(pos.x, pos.y, pos.z);

    const spawnRotation = FPQuaternion.ToFloat(
      teamId === 0 ? FPQuaternion.Identity() : FPQuaternion.FromYaw(FP.Pi)
    );

    refs.root.quaternion.set(
      spawnRotation.x,
      spawnRotation.y,
      spawnRotation.z,
      spawnRotation.w
    );

    this.world.addComponent(entity, AbilityOwner, {
      attributes: {
        Health: FP.FromFloat(def.maxHealth),
        MaxHealth: FP.FromFloat(def.maxHealth),
      },
      abilities: def.abilities,
      tags: [`Team.${teamId}`],
    });
    return entity;
  }

  /** Cosmetic transparent preview for the formation grid (no components). */
  createFormationPreview(type: UnitType, teamId: TeamId): THREE.Object3D {
    const refs = createUnitRenderRefs(
      this.scene,
      UNIT_DEFINITIONS[type],
      teamId
    );
    // A static preview never rotates, so parenting the ring to the root is safe
    // and lets it move with (and be dimmed alongside) the preview.
    if (refs.auraRing) refs.root.add(refs.auraRing);
    dimObject(refs.root);
    return refs.root;
  }

  getDefinition(type: UnitType): UnitDefinition {
    return UNIT_DEFINITIONS[type];
  }
}

function dimObject(root: THREE.Object3D): void {
  root.traverse((child: THREE.Object3D) => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Points)) {
      return;
    }
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      if (
        material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshBasicMaterial ||
        material instanceof THREE.PointsMaterial
      ) {
        material.transparent = true;
        material.opacity *= 0.45;
        material.depthWrite = false;
      }
    }
  });
}

export type { UnitRenderRefs };
