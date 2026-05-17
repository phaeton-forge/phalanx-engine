import { createComponentTypeRegistry } from 'phalanx-ecs';

export const AbilitiesComponentType = createComponentTypeRegistry({
  Attributes: 'phalanx-abilities:Attributes',
  ActiveEffects: 'phalanx-abilities:ActiveEffects',
});
