import { notImplemented } from '../notImplemented.js';
import type { StateReader, StateWriter } from './StateIO.js';

/** Growable little-endian implementation of {@link StateWriter}. */
export class BinaryStateWriter implements StateWriter {
  public constructor(_initialCapacity?: number) {
    notImplemented('BinaryStateWriter', 2);
  }

  public u8(_v: number): void {
    notImplemented('BinaryStateWriter.u8', 2);
  }
  public u32(_v: number): void {
    notImplemented('BinaryStateWriter.u32', 2);
  }
  public i32(_v: number): void {
    notImplemented('BinaryStateWriter.i32', 2);
  }
  public varint(_v: number): void {
    notImplemented('BinaryStateWriter.varint', 2);
  }
  public i64(_v: bigint): void {
    notImplemented('BinaryStateWriter.i64', 2);
  }
  public bool(_v: boolean): void {
    notImplemented('BinaryStateWriter.bool', 2);
  }
  public str(_v: string): void {
    notImplemented('BinaryStateWriter.str', 2);
  }
  public bytes(_v: Uint8Array): void {
    notImplemented('BinaryStateWriter.bytes', 2);
  }
  public section(
    _key: string,
    _version: number,
    _body: (w: StateWriter) => void
  ): void {
    notImplemented('BinaryStateWriter.section', 2);
  }
  public list<T>(
    _items: readonly T[],
    _each: (item: T, w: StateWriter) => void
  ): void {
    notImplemented('BinaryStateWriter.list', 2);
  }
  public sortedBy<T>(
    _items: Iterable<T>,
    _key: (item: T) => number,
    _each: (item: T, w: StateWriter) => void
  ): void {
    notImplemented('BinaryStateWriter.sortedBy', 2);
  }
  /** Exact-length copy of everything written so far. */
  public finish(): Uint8Array {
    return notImplemented('BinaryStateWriter.finish', 2);
  }
}

/** Little-endian implementation of {@link StateReader}. */
export class BinaryStateReader implements StateReader {
  public constructor(_bytes: Uint8Array) {
    notImplemented('BinaryStateReader', 2);
  }

  public u8(): number {
    return notImplemented('BinaryStateReader.u8', 2);
  }
  public u32(): number {
    return notImplemented('BinaryStateReader.u32', 2);
  }
  public i32(): number {
    return notImplemented('BinaryStateReader.i32', 2);
  }
  public varint(): number {
    return notImplemented('BinaryStateReader.varint', 2);
  }
  public i64(): bigint {
    return notImplemented('BinaryStateReader.i64', 2);
  }
  public bool(): boolean {
    return notImplemented('BinaryStateReader.bool', 2);
  }
  public str(): string {
    return notImplemented('BinaryStateReader.str', 2);
  }
  public bytes(): Uint8Array {
    return notImplemented('BinaryStateReader.bytes', 2);
  }
  public section<T>(
    _key: string,
    _read: (r: StateReader, version: number) => T
  ): T {
    return notImplemented('BinaryStateReader.section', 2);
  }
  public list<T>(_read: (r: StateReader, index: number) => T): T[] {
    return notImplemented('BinaryStateReader.list', 2);
  }
  /** Throws if unread bytes remain. */
  public done(): void {
    notImplemented('BinaryStateReader.done', 2);
  }
}
