import type {
  CommandsBatch,
  FrameHandler,
  ITickFrameProvider,
  PauseHandler,
  TickHandler,
  Unsubscribe,
} from '../../src/ITickFrameProvider.js';

/** Clock-less provider. Tests advance the world with {@link ManualTickProvider.step}. */
export class ManualTickProvider implements ITickFrameProvider {
  private readonly tickHandlers: TickHandler[] = [];
  private readonly frameHandlers: FrameHandler[] = [];
  private readonly pauseHandlers: PauseHandler[] = [];
  private readonly resumeHandlers: PauseHandler[] = [];

  public onTick(handler: TickHandler): Unsubscribe {
    this.tickHandlers.push(handler);
    return () => {
      this.remove(this.tickHandlers, handler);
    };
  }

  public onFrame(handler: FrameHandler): Unsubscribe {
    this.frameHandlers.push(handler);
    return () => {
      this.remove(this.frameHandlers, handler);
    };
  }

  public onPause(handler: PauseHandler): Unsubscribe {
    this.pauseHandlers.push(handler);
    return () => {
      this.remove(this.pauseHandlers, handler);
    };
  }

  public onResume(handler: PauseHandler): Unsubscribe {
    this.resumeHandlers.push(handler);
    return () => {
      this.remove(this.resumeHandlers, handler);
    };
  }

  public requestPause(): void {
    for (const handler of this.pauseHandlers) handler();
  }

  public requestResume(): void {
    for (const handler of this.resumeHandlers) handler();
  }

  public step(tick: number, commands?: CommandsBatch): void {
    const batch: CommandsBatch = commands ?? { tick, commands: {} };
    for (const handler of this.tickHandlers) handler(tick, batch);
  }

  public frame(alpha: number, dt: number): void {
    for (const handler of this.frameHandlers) handler(alpha, dt);
  }

  private remove<T>(list: T[], item: T): void {
    const index = list.indexOf(item);
    if (index !== -1) list.splice(index, 1);
  }
}

export function manualTickProvider(): ManualTickProvider {
  return new ManualTickProvider();
}
