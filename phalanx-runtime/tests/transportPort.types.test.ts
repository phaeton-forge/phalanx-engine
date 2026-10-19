import { describe, expectTypeOf, it } from 'vitest';
import type { SubmittedCommand } from '@phalanx-engine/protocol';
import type { TransportCommand } from '../src/game/commands.js';
import type { LocalTransport } from '../src/transport/LocalTransport.js';
import type { Transport } from '../src/transport/Transport.js';

type AssertAssignable<T extends U, U> = T;
export type _LocalTransportIsTransport = AssertAssignable<
  LocalTransport,
  Transport
>;

describe('TransportCommand', () => {
  it('is assignable to SubmittedCommand', () => {
    expectTypeOf<TransportCommand>().toMatchTypeOf<SubmittedCommand>();
  });
});

// @ts-expect-error CommandEnvelope is exported from advanced, not the root
import type { CommandEnvelope as RootEnvelope } from '../src/index.js';
export type _RootEnvelope = RootEnvelope;

// @ts-expect-error TransportCommand is exported from advanced, not the root
import type { TransportCommand as RootTransportCommand } from '../src/index.js';
export type _RootTransportCommand = RootTransportCommand;

// @ts-expect-error Transport is exported from advanced, not the root
import type { Transport as RootTransport } from '../src/index.js';
export type _RootTransport = RootTransport;
