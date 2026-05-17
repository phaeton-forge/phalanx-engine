import { describe, expect, it } from 'vitest';
import { FP } from 'phalanx-math';
import {
  createAbilitySystemRegistries,
  defineAbility,
  defineAttribute,
  defineEffect,
} from '../src';

describe('ability definition registries', () => {
  it('registers and reads attribute, effect, ability, and hook definitions', () => {
    const registries = createAbilitySystemRegistries();

    const health = registries.attributes.register(
      defineAttribute({
        id: 'Health',
        default: FP.FromInt(100),
        min: FP.FromInt(0),
        max: FP.FromInt(100),
        clamp: 'both',
      })
    );

    const damage = registries.effects.register(
      defineEffect({
        id: 'Effect.Damage',
        type: 'Instant',
        modifiers: [{ attributeId: 'Health', op: 'Add', magnitude: FP.FromInt(-10) }],
        cues: ['Cue.Damage.Hit'],
      })
    );

    const ability = registries.abilities.register(
      defineAbility({
        id: 'Ability.Attack',
        target: { kind: 'Entity', origin: { kind: 'Caller' } },
        targetEffectIds: ['Effect.Damage'],
        hookId: 'Hook.Attack',
      })
    );

    registries.hooks.register('Hook.Attack', ctx => {
      expect(ctx.abilityId).toBe('Ability.Attack');
    });

    expect(registries.attributes.get('Health')).toBe(health);
    expect(registries.attributes.indexOf('Health')).toBe(0);
    expect(registries.effects.get('Effect.Damage')).toBe(damage);
    expect(registries.abilities.get('Ability.Attack')).toBe(ability);
    expect(registries.hooks.has('Hook.Attack')).toBe(true);
  });

  it('keeps registries isolated per world instance', () => {
    const firstWorldRegistries = createAbilitySystemRegistries();
    const secondWorldRegistries = createAbilitySystemRegistries();

    firstWorldRegistries.effects.register(
      defineEffect({
        id: 'Effect.Cooldown',
        type: 'Duration',
        durationTicks: 30,
        tagsGranted: ['Cooldown.Ability.Attack'],
      })
    );

    expect(firstWorldRegistries.effects.has('Effect.Cooldown')).toBe(true);
    expect(secondWorldRegistries.effects.has('Effect.Cooldown')).toBe(false);
    expect(firstWorldRegistries.effects.get('Effect.Cooldown').modifiers).toEqual([]);
  });

  it('rejects duplicate definitions deterministically', () => {
    const registries = createAbilitySystemRegistries();
    const effect = defineEffect({ id: 'Effect.Marked', type: 'Duration', durationTicks: 60 });

    registries.effects.register(effect);

    expect(() => registries.effects.register(effect)).toThrow(
      "EffectRegistry already contains 'Effect.Marked'"
    );
  });
});
