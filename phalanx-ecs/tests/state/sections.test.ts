import { afterEach, describe, expect, it } from 'vitest';
import { GameWorld } from '../../src/index.js';
import type { SaveSection } from '../../src/index.js';
import { manualTickProvider } from '../support/manualTickProvider.js';

function section(key: string): SaveSection {
  return {
    key,
    version: 1,
    write() {},
    read() {},
  };
}

describe('save sections', () => {
  it('sorts keys by UTF-16 code units regardless of registration order', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    for (const key of ['b', 'a', 'physics.broadphase', 'abilities']) {
      world.registerSaveSection(section(key));
    }
    expect(world.saveSections.map((item) => item.key)).toEqual([
      'a',
      'abilities',
      'b',
      'physics.broadphase',
    ]);
  });

  it("orders 'Z' before 'a'", () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    world.registerSaveSection(section('a'));
    world.registerSaveSection(section('Z'));
    expect('Z' < 'a').toBe(true);
    expect(world.saveSections.map((item) => item.key)).toEqual(['Z', 'a']);
  });

  it('rejects an empty key and a duplicate key', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    world.registerSaveSection(section('a'));
    expect(() => world.registerSaveSection(section(''))).toThrow(
      'registerSaveSection: key is empty'
    );
    expect(() => world.registerSaveSection(section('a'))).toThrow(
      "registerSaveSection: duplicate key 'a'"
    );
    expect(world.saveSections.map((item) => item.key)).toEqual(['a']);
  });

  it('returns a copy from saveSections', () => {
    const world = new GameWorld({ tickFrameProvider: manualTickProvider() });
    world.registerSaveSection(section('a'));
    world.registerSaveSection(section('b'));
    const listed = world.saveSections as SaveSection[];
    listed.reverse();
    listed.push(section('zzz'));
    expect(world.saveSections.map((item) => item.key)).toEqual(['a', 'b']);
  });
});
