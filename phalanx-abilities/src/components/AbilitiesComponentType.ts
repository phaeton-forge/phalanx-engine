import { createComponentTypeRegistry } from 'phalanx-ecs';

export const AbilitiesComponentType = createComponentTypeRegistry({
  AbilitySystem: 'phalanx-abilities:AbilitySystem',
  Attributes: 'phalanx-abilities:Attributes',
  ActiveEffects: 'phalanx-abilities:ActiveEffects',
  GameplayTags: 'phalanx-abilities:GameplayTags',
});
