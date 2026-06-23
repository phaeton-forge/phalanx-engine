import { FP } from '@phalanx-engine/math';
import type { SoAComponentStore } from '@phalanx-engine/ecs';
import { TransformSoASchema } from '../src/components/TransformComponent';

/** Add a transform row with zero rotation for physics test fixtures. */
export function addTransformRow(
  transformStore: SoAComponentStore<typeof TransformSoASchema.definition>,
  entityId: number,
  posX: number,
  posZ: number,
  posY = 0,
): void {
  transformStore.add(entityId, {
    fpPositionX: FP.ToRaw(FP.FromFloat(posX)),
    fpPositionY: FP.ToRaw(FP.FromFloat(posY)),
    fpPositionZ: FP.ToRaw(FP.FromFloat(posZ)),
    fpRotationX: FP.ToRaw(FP._0),
    fpRotationY: FP.ToRaw(FP._0),
    fpRotationZ: FP.ToRaw(FP._0),
  });
}
