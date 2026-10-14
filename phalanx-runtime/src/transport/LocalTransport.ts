import type {
  FrameHandler,
  PauseHandler,
  TickHandler,
  Unsubscribe,
} from '@phalanx-engine/ecs';
import type { WireCommand } from '../game/commands.js';
import { notImplemented } from '../notImplemented.js';
import type { Transport, TransportKind } from './Transport.js';

export interface LocalTransportOptions {
  /** Ticks per second; must equal `GameDefinition.tickRate`. */
  readonly tickRate: number;
  /** Clamp of a single frame's elapsed time in seconds (default 0.25). */
  readonly maxFrameTime?: number;
}

/**
 * Offline transport: generates ticks from a local clock and loops local
 * input (humans and local bots) back into the batch of its target tick.
 * Persistence (IndexedDB) is added by Task 7 as an injected `MatchStore`.
 */
export class LocalTransport implements Transport {
  public readonly kind: TransportKind = 'local';

  public constructor(_options: LocalTransportOptions) {
    notImplemented('LocalTransport', 6);
  }

  /** Clock-less transport for tests and replays; advance with {@link step}. */
  public static manual(): LocalTransport {
    return notImplemented('LocalTransport.manual', 6);
  }

  /** Manual mode only: emit `count` ticks synchronously. */
  public step(_count?: number): void {
    notImplemented('LocalTransport.step', 6);
  }

  public submit(
    _targetTick: number,
    _slot: number,
    _commands: readonly WireCommand[]
  ): void {
    notImplemented('LocalTransport.submit', 6);
  }

  public onTick(_handler: TickHandler): Unsubscribe {
    return notImplemented('LocalTransport.onTick', 6);
  }

  public onFrame(_handler: FrameHandler): Unsubscribe {
    return notImplemented('LocalTransport.onFrame', 6);
  }

  public requestPause(): void {
    notImplemented('LocalTransport.requestPause', 6);
  }

  public requestResume(): void {
    notImplemented('LocalTransport.requestResume', 6);
  }

  public onPause(_handler: PauseHandler): Unsubscribe {
    return notImplemented('LocalTransport.onPause', 6);
  }

  public onResume(_handler: PauseHandler): Unsubscribe {
    return notImplemented('LocalTransport.onResume', 6);
  }

  public dispose(): void {
    notImplemented('LocalTransport.dispose', 6);
  }
}
