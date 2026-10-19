import { describe, expectTypeOf, it } from 'vitest';
import type {
  MatchSnapshot,
  ServerDesyncEvent,
  ServerSimHook,
} from '@phalanx-engine/protocol';
import { createServerSim } from '../../src/server/createServerSim.js';

describe('ServerSimHook', () => {
  it('accepts createServerSim', () => {
    expectTypeOf(createServerSim).returns.toEqualTypeOf<ServerSimHook>();
  });

  it('uses the socket payloads RoomSim emits', () => {
    expectTypeOf<ServerDesyncEvent>().toEqualTypeOf<{
      playerId: string;
      tick: number;
    }>();
    expectTypeOf<MatchSnapshot>().toEqualTypeOf<{
      tick: number;
      bytes: Uint8Array;
      requestId: number;
    }>();
  });
});
