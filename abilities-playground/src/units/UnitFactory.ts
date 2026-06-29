import * as THREE from 'three';
import { Entity } from '@phalanx-engine/ecs';
import { FP, FPQuaternion } from '@phalanx-engine/math';
import type { AbilitySystem } from '@phalanx-engine/abilities';
import type { TeamId } from '../components';
import { UNIT_DEFINITIONS } from './unitDefinitions';
import { assembleUnit } from './unitAssembler';
import { createUnitRenderRefs, type UnitRenderRefs } from './unitVisuals';
import type { UnitType } from './UnitType';
import type { UnitDefinition } from './UnitDefinition';

export class UnitFactory {
  private readonly scene: THREE.Scene;
  private readonly abilities: AbilitySystem;

  constructor(scene: THREE.Scene, abilities: AbilitySystem) {
    this.scene = scene;
    this.abilities = abilities;
  }

  /** Full deterministic battle entity (caller adds it to the world). */
  spawnBattleUnit(
    type: UnitType,
    teamId: TeamId,
    pos: { x: number; y: number; z: number },
  ): Entity {
    const def = UNIT_DEFINITIONS[type];
    const refs = createUnitRenderRefs(this.scene, def, teamId);
    this.scene.add(refs.healthBarRoot);

    const entity = new Entity();
    assembleUnit(entity, def, teamId, pos, refs);

    refs.root.position.set(pos.x, pos.y, pos.z);

    const spawnRotation = FPQuaternion.ToFloat(
      teamId === 0 ? FPQuaternion.Identity() : FPQuaternion.FromYaw(FP.Pi),
    );

    refs.root.quaternion.set(
      spawnRotation.x,
      spawnRotation.y,
      spawnRotation.z,
      spawnRotation.w,
    );

    entity.addComponent(
      this.abilities.initComponent({
        attributes: {
          Health: FP.FromFloat(def.maxHealth),
          MaxHealth: FP.FromFloat(def.maxHealth),
        },
        abilities: def.abilities,
        tags: [`Team.${teamId}`],
      }),
    );
    return entity;
  }

  /** Cosmetic transparent preview for the formation grid (no components). */
  createFormationPreview(type: UnitType, teamId: TeamId): THREE.Object3D {
    const refs = createUnitRenderRefs(this.scene, UNIT_DEFINITIONS[type], teamId);
    dimObject(refs.root);
    return refs.root;
  }

  getDefinition(type: UnitType): UnitDefinition {
    return UNIT_DEFINITIONS[type];
  }
}

function dimObject(root: THREE.Object3D): void {
  root.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (
          material instanceof THREE.MeshStandardMaterial ||
          material instanceof THREE.MeshBasicMaterial
        ) {
          material.transparent = true;
          material.opacity = 0.45;
          material.depthWrite = false;
        }
      }
    }
  });
}

export type { UnitRenderRefs };
