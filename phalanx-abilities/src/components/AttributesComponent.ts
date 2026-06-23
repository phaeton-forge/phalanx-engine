import type { IComponent } from '@phalanx-engine/ecs';
import { AbilitiesComponentType } from './AbilitiesComponentType';

export class AttributesComponent implements IComponent {
  public readonly type = AbilitiesComponentType.Attributes;
  public readonly base: BigInt64Array;
  public readonly current: BigInt64Array;
  public readonly dirty: Uint8Array;

  public constructor(attributeCount: number) {
    if (!Number.isInteger(attributeCount) || attributeCount < 0) {
      throw new Error(`attributeCount must be a non-negative integer, got ${attributeCount}`);
    }

    this.base = new BigInt64Array(attributeCount);
    this.current = new BigInt64Array(attributeCount);
    this.dirty = new Uint8Array(attributeCount);
  }
}
