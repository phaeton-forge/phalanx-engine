import type { StateReader, StateWriter } from '@phalanx-engine/ecs';
import { defineComponent } from '@phalanx-engine/ecs';
import type { ActiveEffectInstance } from '../types/index.js';
import {
  ABSENT,
  PRESENT,
  readFixedPoint,
  readSetByCaller,
  requireFixedPoint,
  writeFixedPoint,
  writeSetByCaller,
} from '../save/codec.js';

export interface PendingEffectAdd {
  defId: string;
  sourceEntityId: number;
  /** SetByCaller payload from `applyEffect`; `undefined`/`null` when the caller omitted it. */
  setByCaller?: ReadonlyMap<string, unknown> | null;
}

export interface ActiveEffectsState {
  readonly queue: ActiveEffectInstance[];
  readonly pendingAdd: PendingEffectAdd[];
}

export function createActiveEffectsState(): ActiveEffectsState {
  return { queue: [], pendingAdd: [] };
}

function writeCapturedMagnitudes(
  w: StateWriter,
  magnitudes: ActiveEffectInstance['capturedMagnitudes']
): void {
  if (magnitudes === undefined || magnitudes === null) {
    w.u8(ABSENT);
    return;
  }
  w.u8(PRESENT);
  w.list(magnitudes, (magnitude, item) => {
    writeFixedPoint(
      item,
      requireFixedPoint(magnitude, 'capturedMagnitudes entry')
    );
  });
}

function readCapturedMagnitudes(
  r: StateReader
): ActiveEffectInstance['capturedMagnitudes'] {
  const tag = r.u8();
  if (tag === ABSENT) return null;
  if (tag !== PRESENT) {
    throw new Error(
      `readAbilities: unknown capturedMagnitudes tag ${String(tag)}`
    );
  }
  return r.list((item) => readFixedPoint(item));
}

/** `queue`, then `pendingAdd`, both in array order. */
export function saveActiveEffects(
  effects: ActiveEffectsState,
  w: StateWriter
): void {
  w.list(effects.queue, (instance, item) => {
    item.varint(instance.instanceId);
    item.str(instance.defId);
    item.i32(instance.sourceEntityId);
    item.i32(instance.remainingTicks);
    item.i32(instance.nextPeriodTick);
    item.i32(instance.enteredOnTick);
    writeCapturedMagnitudes(item, instance.capturedMagnitudes);
  });
  w.list(effects.pendingAdd, (pending, item) => {
    item.str(pending.defId);
    item.i32(pending.sourceEntityId);
    writeSetByCaller(item, pending.setByCaller);
  });
}

export function loadActiveEffects(r: StateReader): ActiveEffectsState {
  const queue = r.list((item): ActiveEffectInstance => ({
    instanceId: item.varint(),
    defId: item.str(),
    sourceEntityId: item.i32(),
    remainingTicks: item.i32(),
    nextPeriodTick: item.i32(),
    enteredOnTick: item.i32(),
    capturedMagnitudes: readCapturedMagnitudes(item),
  }));
  const pendingAdd = r.list((item): PendingEffectAdd => ({
    defId: item.str(),
    sourceEntityId: item.i32(),
    setByCaller: readSetByCaller(item),
  }));
  return { queue, pendingAdd };
}

export const ActiveEffects = defineComponent<ActiveEffectsState>(
  'ActiveEffects',
  {
    kind: 'object',
    create: createActiveEffectsState,
    save: saveActiveEffects,
    load: loadActiveEffects,
  }
);

/** Replace both lists in place. Spreading into `splice` throws on long lists. */
export function copyActiveEffects(
  target: ActiveEffectsState,
  source: ActiveEffectsState
): void {
  target.queue.length = 0;
  for (let index = 0; index < source.queue.length; index += 1) {
    const instance = source.queue[index];
    if (instance !== undefined) target.queue.push(instance);
  }
  target.pendingAdd.length = 0;
  for (let index = 0; index < source.pendingAdd.length; index += 1) {
    const pending = source.pendingAdd[index];
    if (pending !== undefined) target.pendingAdd.push(pending);
  }
}
