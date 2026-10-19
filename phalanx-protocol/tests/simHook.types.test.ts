import { describe, expectTypeOf, it } from 'vitest';
import type {
  MatchSnapshot,
  ServerDesyncEvent,
  ServerSimEvents,
  ServerSimHook,
} from '@phalanx-engine/protocol';
import type { PhalanxEventHandlers } from '@phalanx-engine/server';
import { createServerSim } from '@phalanx-engine/runtime/server';

describe('ServerSimHook', () => {
  it('accepts createServerSim', () => {
    expectTypeOf(createServerSim).returns.toEqualTypeOf<ServerSimHook>();
  });

  it('matches the server events the sim emits', () => {
    expectTypeOf<ServerSimEvents['sim-digest']>().toEqualTypeOf<
      PhalanxEventHandlers['sim-digest']
    >();
    expectTypeOf<ServerSimEvents['sim-lag']>().toEqualTypeOf<
      PhalanxEventHandlers['sim-lag']
    >();
    expectTypeOf<ServerSimEvents['sim-fault']>().toEqualTypeOf<
      PhalanxEventHandlers['sim-fault']
    >();
    expectTypeOf<ServerSimEvents['desync-detected']>().toEqualTypeOf<
      PhalanxEventHandlers['desync-detected']
    >();
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
