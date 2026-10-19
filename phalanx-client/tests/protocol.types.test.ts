import { describe, expectTypeOf, it } from 'vitest';
import type * as Client from '@phalanx-engine/client';
import type * as Protocol from '@phalanx-engine/protocol';
import type * as Server from '@phalanx-engine/server';

describe('wire types shared by client and server', () => {
  it('re-exports the protocol command and match events', () => {
    expectTypeOf<Client.PlayerCommand>().toEqualTypeOf<Protocol.PlayerCommand>();
    expectTypeOf<Server.PlayerCommand>().toEqualTypeOf<Protocol.PlayerCommand>();
    expectTypeOf<Client.MatchFoundEvent>().toEqualTypeOf<Protocol.MatchFoundEvent>();
    expectTypeOf<Server.MatchFoundEvent>().toEqualTypeOf<Protocol.MatchFoundEvent>();
    expectTypeOf<Client.GameStartEvent>().toEqualTypeOf<Protocol.GameStartEvent>();
    expectTypeOf<Server.GameStartEvent>().toEqualTypeOf<Protocol.GameStartEvent>();
    expectTypeOf<Client.TickSyncEvent>().toEqualTypeOf<Protocol.TickSyncEvent>();
    expectTypeOf<Server.TickSyncEvent>().toEqualTypeOf<Protocol.TickSyncEvent>();
    expectTypeOf<Client.CommandsBatchEvent>().toEqualTypeOf<Protocol.CommandsBatchEvent>();
    expectTypeOf<Server.CommandsBatchEvent>().toEqualTypeOf<Protocol.CommandsBatchEvent>();
    expectTypeOf<Client.QueueStatusEvent>().toEqualTypeOf<Protocol.QueueStatusEvent>();
    expectTypeOf<Server.QueueStatusEvent>().toEqualTypeOf<Protocol.QueueStatusEvent>();
    expectTypeOf<Client.ServerShutdownEvent>().toEqualTypeOf<Protocol.ServerShutdownEvent>();
    expectTypeOf<Server.ServerShutdownEvent>().toEqualTypeOf<Protocol.ServerShutdownEvent>();
    expectTypeOf<Client.SessionTokenEvent>().toEqualTypeOf<Protocol.SessionTokenEvent>();
    expectTypeOf<Server.SessionTokenEvent>().toEqualTypeOf<Protocol.SessionTokenEvent>();
    expectTypeOf<Client.SessionSupersededEvent>().toEqualTypeOf<Protocol.SessionSupersededEvent>();
    expectTypeOf<Server.SessionSupersededEvent>().toEqualTypeOf<Protocol.SessionSupersededEvent>();
  });

  it('re-exports the protocol room, log, and resume events', () => {
    expectTypeOf<Client.RoomCreatedEvent>().toEqualTypeOf<Protocol.RoomCreatedEvent>();
    expectTypeOf<Server.RoomCreatedEvent>().toEqualTypeOf<Protocol.RoomCreatedEvent>();
    expectTypeOf<Client.RoomRecoveredEvent>().toEqualTypeOf<Protocol.RoomRecoveredEvent>();
    expectTypeOf<Server.RoomRecoveredEvent>().toEqualTypeOf<Protocol.RoomRecoveredEvent>();
    expectTypeOf<Client.RoomErrorEvent>().toEqualTypeOf<Protocol.RoomErrorEvent>();
    expectTypeOf<Server.RoomErrorEvent>().toEqualTypeOf<Protocol.RoomErrorEvent>();
    expectTypeOf<Server.MatchLogErrorReason>().toEqualTypeOf<Protocol.MatchLogErrorReason>();
    expectTypeOf<Client.MatchLogEntry>().toEqualTypeOf<Protocol.MatchLogEntry>();
    expectTypeOf<Server.MatchLogEntry>().toEqualTypeOf<Protocol.MatchLogEntry>();
    expectTypeOf<Client.MatchLogChunkEvent>().toEqualTypeOf<Protocol.MatchLogChunkEvent>();
    expectTypeOf<Server.MatchLogChunkEvent>().toEqualTypeOf<Protocol.MatchLogChunkEvent>();
    expectTypeOf<Client.MatchLogErrorEvent>().toEqualTypeOf<Protocol.MatchLogErrorEvent>();
    expectTypeOf<Server.MatchLogErrorEvent>().toEqualTypeOf<Protocol.MatchLogErrorEvent>();
    expectTypeOf<Server.MatchResumeErrorReason>().toEqualTypeOf<Protocol.MatchResumeErrorReason>();
    expectTypeOf<Protocol.MatchLogErrorReason>().toMatchTypeOf<Client.MatchLogFailureReason>();
    expectTypeOf<Protocol.MatchResumeErrorReason>().toMatchTypeOf<Client.MatchResumeFailureReason>();
    expectTypeOf<Client.MatchResumeState>().toEqualTypeOf<Protocol.MatchResumeState>();
    expectTypeOf<Server.MatchResumeState>().toEqualTypeOf<Protocol.MatchResumeState>();
  });
});

describe('client event parameters', () => {
  it('uses the protocol payload for each relay event', () => {
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['matchFound']>[0]
    >().toEqualTypeOf<Protocol.MatchFoundEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['countdown']>[0]
    >().toEqualTypeOf<Protocol.CountdownEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['gameStart']>[0]
    >().toEqualTypeOf<Protocol.GameStartEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['matchEnd']>[0]
    >().toEqualTypeOf<Protocol.MatchEndEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['gamePaused']>[0]
    >().toEqualTypeOf<Protocol.GamePausedEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['gameResumed']>[0]
    >().toEqualTypeOf<Protocol.GameResumedEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['tick']>[0]
    >().toEqualTypeOf<Protocol.TickSyncEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['commands']>[0]
    >().toEqualTypeOf<Protocol.CommandsBatchEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['playerDisconnected']>[0]
    >().toEqualTypeOf<Protocol.PlayerDisconnectedEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['playerReconnected']>[0]
    >().toEqualTypeOf<Protocol.PlayerReconnectedEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['playerReady']>[0]
    >().toEqualTypeOf<Protocol.PlayerReadyEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['reconnectState']>[0]
    >().toEqualTypeOf<Protocol.ReconnectStateEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['reconnectStatus']>[0]
    >().toEqualTypeOf<Protocol.ReconnectStatusEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['roomCreated']>[0]
    >().toEqualTypeOf<Protocol.RoomCreatedEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['roomError']>[0]
    >().toEqualTypeOf<Protocol.RoomErrorEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['roomExpired']>[0]
    >().toEqualTypeOf<Protocol.RoomExpiredEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['roomCancelled']>[0]
    >().toEqualTypeOf<Protocol.RoomCancelledEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['roomRecovered']>[0]
    >().toEqualTypeOf<Protocol.RoomRecoveredEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['serverShutdown']>[0]
    >().toEqualTypeOf<Protocol.ServerShutdownEvent>();
    expectTypeOf<
      Parameters<Client.PhalanxClientEvents['sessionSuperseded']>[0]
    >().toEqualTypeOf<Protocol.SessionSupersededEvent>();
  });
});

describe('fields the client type now includes', () => {
  it('types room-error sim-unavailable, game-start matchConfig, and resume snapshot', () => {
    expectTypeOf<Protocol.RoomErrorEvent['reason']>().toEqualTypeOf<
      'session-token-required' | 'sim-unavailable' | undefined
    >();
    expectTypeOf<Client.GameStartEvent['matchConfig']>().toEqualTypeOf<
      { readonly [key: string]: unknown } | undefined
    >();
    expectTypeOf<Client.MatchResumeState['snapshot']>().toEqualTypeOf<
      { tick: number } | undefined
    >();
  });
});
