import { describe, expect, it } from 'vitest';
import type { IRandom } from '@phalanx-engine/ecs';
import { DeterministicRandom } from '@phalanx-engine/math';
import { StateHelpers } from '../../../src/advanced/StateHelpers.js';
import { BinaryStateReader, BinaryStateWriter } from '@phalanx-engine/ecs';

function finish(fill: (w: BinaryStateWriter) => void): Uint8Array {
  const writer = new BinaryStateWriter();
  fill(writer);
  return writer.finish();
}

class WordRng implements IRandom {
  private words: number[];
  public draws = 0;

  public constructor(words: readonly number[]) {
    this.words = [...words];
  }

  public getState(): readonly number[] {
    return [...this.words];
  }

  public setState(state: readonly number[]): void {
    this.words = [...state];
  }

  public float(): number {
    throw new Error('float called');
  }

  public floatRange(): number {
    throw new Error('floatRange called');
  }

  public int(): number {
    this.draws += 1;
    throw new Error('int called');
  }

  public intRange(): number {
    throw new Error('intRange called');
  }

  public boolean(): boolean {
    throw new Error('boolean called');
  }

  public pick<T>(): T {
    throw new Error('pick called');
  }

  public shuffle<T>(): T[] {
    throw new Error('shuffle called');
  }
}

describe('RNG state helpers', () => {
  it('continues a DeterministicRandom sequence', () => {
    const source = new DeterministicRandom(99);
    for (let i = 0; i < 5; i += 1) {
      source.int(10);
    }
    const snapshot = source.getState();
    const upcoming = [source.int(1000), source.int(1000), source.int(1000)];

    const bytes = finish((writer) => {
      StateHelpers.writeRandom(writer, DeterministicRandom.fromState(snapshot));
    });
    const again = finish((writer) => {
      StateHelpers.writeRandom(writer, DeterministicRandom.fromState(snapshot));
    });
    expect(again).toEqual(bytes);

    const restored = new DeterministicRandom(0);
    const reader = new BinaryStateReader(bytes);
    StateHelpers.readRandom(reader, restored);
    reader.done();

    expect([
      restored.int(1000),
      restored.int(1000),
      restored.int(1000),
    ]).toEqual(upcoming);
  });

  it('uses getState and setState and rejects an rng without them', () => {
    const words = [1, -2, 3, 4];
    const source = new WordRng(words);
    const bytes = finish((writer) => {
      StateHelpers.writeRandom(writer, source);
    });
    expect(source.draws).toBe(0);

    const restored = new WordRng([0, 0, 0, 0]);
    const reader = new BinaryStateReader(bytes);
    StateHelpers.readRandom(reader, restored);
    reader.done();
    expect(restored.getState()).toEqual(words);
    expect(restored.draws).toBe(0);

    const bare: IRandom = {
      float: () => 0,
      floatRange: () => 0,
      int: () => 0,
      intRange: () => 0,
      boolean: () => false,
      pick: <T>(array: readonly T[]): T => {
        const item = array[0];
        if (item === undefined) {
          throw new Error('empty');
        }
        return item;
      },
      shuffle: <T>(array: T[]): T[] => array,
    };
    expect(() =>
      finish((writer) => {
        StateHelpers.writeRandom(writer, bare);
      })
    ).toThrow('writeRandom: rng has no getState');
  });
});
