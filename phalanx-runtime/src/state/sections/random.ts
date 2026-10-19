import type { IRandom, StateReader, StateWriter } from '@phalanx-engine/ecs';
import { assertSectionVersion, ENGINE_SECTION_VERSION } from './version.js';

/** `xoroshiro128plus` state is four signed int32 words. */
const XOROSHIRO_WORDS = 4;

interface RandomState {
  getState(): readonly number[];
  setState(state: readonly number[]): void;
}

function readState(rng: IRandom): readonly number[] {
  const candidate = rng as IRandom & Partial<RandomState>;
  if (typeof candidate.getState !== 'function') {
    throw new Error('writeRandom: rng has no getState');
  }
  const state = candidate.getState();
  if (state.length !== XOROSHIRO_WORDS) {
    throw new Error(
      `writeRandom: expected ${String(XOROSHIRO_WORDS)} state words, got ${String(state.length)}`
    );
  }
  return state;
}

function writeState(rng: IRandom, state: readonly number[]): void {
  const candidate = rng as IRandom & Partial<RandomState>;
  if (typeof candidate.setState !== 'function') {
    throw new Error('readRandom: rng has no setState');
  }
  candidate.setState(state);
}

/**
 * `DeterministicRandom` state: `section('random', 1)` and four `i32` words
 * from `getState()`. Does not call `getGenerator`.
 *
 * @throws If `rng` has no `getState`, or the state is not four words.
 */
export function writeRandom(w: StateWriter, rng: IRandom): void {
  const state = readState(rng);
  w.section('random', ENGINE_SECTION_VERSION, (section) => {
    section.list(state, (word, item) => {
      item.i32(word);
    });
  });
}

/**
 * Continues the saved sequence via `setState`. The next `int` / `intRange`
 * matches the generator that was saved.
 *
 * @throws If `rng` has no `setState`, or the section is not four words.
 */
export function readRandom(r: StateReader, rng: IRandom): void {
  const words = r.section('random', (section, version) => {
    assertSectionVersion('readRandom', version);
    return section.list((item) => item.i32());
  });
  if (words.length !== XOROSHIRO_WORDS) {
    throw new Error(
      `readRandom: expected ${String(XOROSHIRO_WORDS)} state words, got ${String(words.length)}`
    );
  }
  writeState(rng, words);
}
