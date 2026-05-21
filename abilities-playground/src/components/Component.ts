import { createComponentTypeRegistry } from 'phalanx-ecs';

export const ComponentType = createComponentTypeRegistry({
  Transform: 'Transform',
  Unit: 'Unit',
  Combat: 'Combat',
  Targeting: 'Targeting',
  Visual: 'Visual',
  Lifecycle: 'Lifecycle',
});
