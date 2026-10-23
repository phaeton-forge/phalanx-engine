import { describe, expect, it } from 'vitest';
import {
  BinaryStateReader,
  BinaryStateWriter,
  GameWorld,
  type StateReader,
  type StateWriter,
} from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import {
  AbilityOwner,
  ActiveEffects,
  Attributes,
  GameplayTags,
  type AbilityOwnerState,
  type GameplayTagsState,
} from '../src/index.js';
import { attributesValue } from './helpers.js';
import { manualTickProvider } from './support/manualTickProvider.js';

interface Codec<T> {
  save?(value: T, writer: StateWriter): void;
  load?(reader: StateReader): T;
}

function encode<T>(component: Codec<T>, value: T): Uint8Array {
  const writer = new BinaryStateWriter();
  component.save?.(value, writer);
  return writer.finish();
}

function decode<T>(component: Codec<T>, bytes: Uint8Array): T {
  const value = component.load?.(new BinaryStateReader(bytes));
  if (value === undefined) throw new Error('missing load');
  return value;
}

function tagsIn(order: readonly string[]): GameplayTagsState {
  const state = GameplayTags.create();
  for (const tag of order) {
    state.tags.add(tag);
    state.adHocTags.add(tag);
    state.effectGrantCounts.set(tag, tag.length);
  }
  return state;
}

function ownerWith(abilities: readonly string[]): AbilityOwnerState {
  const owner = AbilityOwner.create();
  for (const id of abilities) owner.abilities.add(id);
  return owner;
}

describe('abilities components', () => {
  it('are object components with save and load', () => {
    for (const component of [AbilityOwner, Attributes, ActiveEffects]) {
      expect(component.kind).toBe('object');
      expect(typeof component.save).toBe('function');
      expect(typeof component.load).toBe('function');
    }
    expect(GameplayTags.kind).toBe('object');
    expect(AbilityOwner.name).toBe('AbilityOwner');
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    expect(() => world.registerComponent(GameplayTags)).not.toThrow();
  });

  it('GameplayTags.save sorts tags, ad-hoc tags and grants', () => {
    const forward = encode(GameplayTags, tagsIn(['b.Tag', 'a.Tag', 'C.Tag']));
    const reverse = encode(GameplayTags, tagsIn(['C.Tag', 'a.Tag', 'b.Tag']));
    expect(forward).toEqual(reverse);
    const loaded = decode(GameplayTags, forward);
    expect([...loaded.tags]).toEqual(['C.Tag', 'a.Tag', 'b.Tag']);
    expect([...loaded.adHocTags]).toEqual(['C.Tag', 'a.Tag', 'b.Tag']);
    expect([...loaded.effectGrantCounts]).toEqual([
      ['C.Tag', 5],
      ['a.Tag', 5],
      ['b.Tag', 5],
    ]);
  });

  it('AbilityOwner.save sorts ability ids', () => {
    const forward = encode(AbilityOwner, ownerWith(['Ability.Z', 'Ability.A']));
    const reverse = encode(AbilityOwner, ownerWith(['Ability.A', 'Ability.Z']));
    expect(forward).toEqual(reverse);
    expect([...decode(AbilityOwner, forward).abilities]).toEqual([
      'Ability.A',
      'Ability.Z',
    ]);
  });

  it('round-trips attributes and active effects exactly', () => {
    const attributes = attributesValue(2);
    attributes.base[1] = FP.ToRaw(FP.FromInt(7));
    attributes.current[1] = -3n;
    attributes.dirty[0] = 1;
    const loadedAttributes = decode(Attributes, encode(Attributes, attributes));
    expect(loadedAttributes.base).toEqual(attributes.base);
    expect(loadedAttributes.current).toEqual(attributes.current);
    expect(loadedAttributes.dirty).toEqual(attributes.dirty);

    const effects = ActiveEffects.create();
    effects.queue.push({
      instanceId: 4,
      defId: 'Effect.Burn',
      sourceEntityId: 2,
      remainingTicks: 5,
      nextPeriodTick: 3,
      enteredOnTick: 1,
      capturedMagnitudes: [FP.FromInt(2)],
    });
    effects.pendingAdd.push({
      defId: 'Effect.Heal',
      sourceEntityId: -1,
      setByCaller: new Map<string, unknown>([['amount', 3]]),
    });
    const bytes = encode(ActiveEffects, effects);
    const loadedEffects = decode(ActiveEffects, bytes);
    expect(encode(ActiveEffects, loadedEffects)).toEqual(bytes);
    const magnitude = loadedEffects.queue[0]?.capturedMagnitudes?.[0];
    expect(magnitude !== undefined && FP.Eq(magnitude, FP.FromInt(2))).toBe(
      true
    );
    expect(loadedEffects.pendingAdd[0]?.setByCaller?.get('amount')).toBe(3);
  });

  it('creates independent values', () => {
    const first = GameplayTags.create();
    first.tags.add('Team.Red');
    expect(GameplayTags.create().tags.size).toBe(0);
    expect(Attributes.create().base.length).toBe(0);
  });
});
