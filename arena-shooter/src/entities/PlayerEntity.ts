import type { EntityFactory } from '../core/EntityFactory.ts';

export function createPlayer(factory: EntityFactory): number {
  return factory.createPlayer();
}
