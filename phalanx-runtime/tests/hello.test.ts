import { describe, expect, it } from 'vitest';
import { playHello } from './fixtures/hello.js';

describe('hello world', () => {
  it('moves a unit with a bot and restores that position', () => {
    const [before, after] = playHello();
    expect(before > 2n).toBe(true);
    expect(after).toBe(before);
  });
});
