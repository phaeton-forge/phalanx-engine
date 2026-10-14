import { describe, expect, it } from 'vitest';
import { defineGame, type GameDefinition } from '../src/index.js';

function validDefinition(): GameDefinition {
  return {
    id: 'smoke',
    simVersion: 'smoke-1',
    tickRate: 10,
    createWorld: () => {
      throw new Error('not used');
    },
    commands: {
      types: ['noop'],
      decode: () => ({ type: 'noop' }),
    },
    state: {
      formatVersion: 1,
      bind: () => ({ save: () => {}, restore: () => {} }),
    },
    outcome: () => null,
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

describe('defineGame', () => {
  it('returns the very same definition object', () => {
    const def = validDefinition();
    expect(defineGame(def)).toBe(def);
  });

  it('accepts optional bots', () => {
    const def = {
      ...validDefinition(),
      bots: { idle: () => ({ decide: () => [] }) },
    };
    expect(defineGame(def)).toBe(def);
  });

  it.each([
    ['id', /id must be a non-empty string/],
    ['simVersion', /simVersion must be a non-empty string/],
    ['tickRate', /tickRate must be a positive integer/],
    ['state', /state \(GameStateSpec\) is required/],
    ['createWorld', /createWorld must be a function/],
    ['commands', /commands must be a CommandSchema object/],
    ['outcome', /outcome must be a function/],
  ])('throws when %s is missing', (field, message) => {
    expect(() => defineGame(without(field))).toThrow(message);
  });

  it.each([0, -10, 2.5, Number.NaN])('rejects tickRate %s', (tickRate) => {
    expect(() => defineGame(withField('tickRate', tickRate))).toThrow(
      /tickRate must be a positive integer/
    );
  });

  it('rejects an empty id and names the game in later errors', () => {
    expect(() => defineGame(withField('id', ''))).toThrow(/id must be/);
    expect(() => defineGame(withField('simVersion', ''))).toThrow(
      /game 'smoke': simVersion/
    );
  });

  it('validates the state spec', () => {
    expect(() =>
      defineGame(withField('state', { formatVersion: 0, bind: () => ({}) }))
    ).toThrow(/state.formatVersion must be a positive integer/);
    expect(() => defineGame(withField('state', { formatVersion: 1 }))).toThrow(
      /state.bind must be a function/
    );
  });

  it('validates the command schema', () => {
    expect(() => defineGame(withField('commands', { types: ['a'] }))).toThrow(
      /commands.decode must be a function/
    );
    expect(() =>
      defineGame(withField('commands', { decode: () => null }))
    ).toThrow(/commands.types must be an array/);
  });

  it('validates bot factories', () => {
    expect(() => defineGame(withField('bots', { standard: 42 }))).toThrow(
      /bots.standard must be a function/
    );
  });

  it('rejects non-object input', () => {
    expect(() => defineGame(null as unknown as GameDefinition)).toThrow(
      /definition must be an object/
    );
  });
});
