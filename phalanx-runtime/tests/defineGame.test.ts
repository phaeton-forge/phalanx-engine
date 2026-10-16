import { describe, expect, it } from 'vitest';
import {
  defineCommands,
  defineGame,
  type GameDefinition,
} from '../src/index.js';

function commands() {
  return defineCommands({ noop: {} });
}

function validDefinition(): GameDefinition {
  return {
    id: 'smoke',
    simVersion: 'smoke-1',
    tickRate: 10,
    commands: commands(),
    onCommand: { noop() {} },
    checkOutcome: () => null,
    save: {
      formatVersion: 1,
      handler: () => ({ save: () => {}, restore: () => {} }),
    },
  };
}

/** Bypasses static typing to feed malformed definitions to the validator. */
function withField(field: string, value: unknown): GameDefinition {
  return { ...validDefinition(), [field]: value } as GameDefinition;
}

function without(field: string): GameDefinition {
  const def: Record<string, unknown> = { ...validDefinition() };
  delete def[field];
  return def as unknown as GameDefinition;
}

/**
 * The wide `GameDefinition` stores `onCommand` as `object` so a concrete
 * handler map stays assignable to `AnyGameDefinition`. These cases feed
 * that value, including malformed ones, into the runtime validator.
 */
function check(def: object | null): GameDefinition {
  return defineGame(def as never);
}

describe('defineGame', () => {
  it('returns the very same definition object when save is present', () => {
    const def = validDefinition();
    expect(check(def)).toBe(def);
  });

  it('accepts optional bots', () => {
    const def = {
      ...validDefinition(),
      bots: { idle: () => ({ decide: () => [] }) },
    };
    expect(check(def)).toBe(def);
  });

  it.each([
    ['id', /id must be a non-empty string/],
    ['simVersion', /simVersion must be a non-empty string/],
    ['tickRate', /tickRate must be a positive integer/],
    ['commands', /commands must be a defineCommands\(\) result/],
    ['onCommand', /onCommand must be a function or a handler map/],
    ['checkOutcome', /checkOutcome must be a function/],
  ])('throws when %s is missing', (field, message) => {
    expect(() => check(without(field))).toThrow(message);
  });

  it.each([0, -10, 2.5, Number.NaN])('rejects tickRate %s', (tickRate) => {
    expect(() => check(withField('tickRate', tickRate))).toThrow(
      /tickRate must be a positive integer/
    );
  });

  it('rejects an empty id and names the game in later errors', () => {
    expect(() => check(withField('id', ''))).toThrow(/id must be/);
    expect(() => check(withField('simVersion', ''))).toThrow(
      /game 'smoke': simVersion/
    );
  });

  it('uses world modules when save is omitted', () => {
    const def = without('save');
    const game = check(def);
    expect(game).not.toBe(def);
    expect(game.save.formatVersion).toBe(1);
    expect(typeof game.save.handler).toBe('function');
  });

  it('validates the save spec', () => {
    expect(() =>
      check(withField('save', { formatVersion: 0, handler: () => ({}) }))
    ).toThrow(/save.formatVersion must be a positive integer/);
    expect(() => check(withField('save', { formatVersion: 1 }))).toThrow(
      /save.handler must be a function/
    );
  });

  it('validates the command codec', () => {
    expect(() => check(withField('commands', { types: ['a'] }))).toThrow(
      /commands.schema must be an array/
    );
    expect(() =>
      check(
        withField('commands', {
          types: ['a'],
          schema: [],
          decode: () => null,
        })
      )
    ).toThrow(/commands.encode must be a function/);
  });

  it('requires a handler for every command type', () => {
    expect(() => check(withField('onCommand', { other() {} }))).toThrow(
      /onCommand.noop must be a function/
    );
  });

  it('validates bot factories', () => {
    expect(() => check(withField('bots', { standard: 42 }))).toThrow(
      /bots.standard must be a function/
    );
  });

  it('rejects non-object input', () => {
    expect(() => check(null)).toThrow(/definition must be an object/);
  });
});
