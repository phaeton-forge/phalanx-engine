import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './Component.ts';

/**
 * PlayerComponent — associates a checker entity with a network player.
 *
 * playerIndex 0 = white (goes first), playerIndex 1 = black.
 * networkId is the playerId assigned by the server.
 *
 * Only used in online mode; not attached in hot-seat.
 */
export class PlayerComponent implements IComponent {
  public readonly type = ComponentType.Player;

  constructor(
      // @ts-ignore
      public readonly playerIndex: number,
      // @ts-ignore
      public readonly networkId: string,
  ) {}
}
