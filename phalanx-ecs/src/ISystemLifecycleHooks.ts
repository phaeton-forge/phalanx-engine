import type { CommandsBatch } from './ITickFrameProvider';

/**
 * Optional lifecycle interfaces for GameSystem subclasses.
 *
 * When a registered system implements one of these interfaces, GameWorld
 * automatically calls the corresponding method at the right point in the
 * tick/frame pipeline – before user-supplied GameWorldHooks run for the
 * "before" variants, and after tick/frame systems run for the "after"
 * variants.
 *
 * Pipeline order per tick:
 *   IBeforeTick systems → beforeTick hook → tick systems
 *   → tick systems → IAfterTick systems → afterTick hook
 *
 * Pipeline order per frame:
 *   IBeforeFrame systems → beforeFrame hook → frame systems
 *   → frame systems → IAfterFrame systems → afterFrame hook
 */

export interface IBeforeTick {
  beforeTick(tick: number, commands: CommandsBatch): void;
}

export interface IAfterTick {
  afterTick(tick: number): void;
}

export interface IBeforeFrame {
  beforeFrame(alpha: number, dt: number): void;
}

export interface IAfterFrame {
  afterFrame(alpha: number, dt: number): void;
}

export function isBeforeTick(system: object): system is IBeforeTick {
  return typeof (system as IBeforeTick).beforeTick === 'function';
}

export function isAfterTick(system: object): system is IAfterTick {
  return typeof (system as IAfterTick).afterTick === 'function';
}

export function isBeforeFrame(system: object): system is IBeforeFrame {
  return typeof (system as IBeforeFrame).beforeFrame === 'function';
}

export function isAfterFrame(system: object): system is IAfterFrame {
  return typeof (system as IAfterFrame).afterFrame === 'function';
}
