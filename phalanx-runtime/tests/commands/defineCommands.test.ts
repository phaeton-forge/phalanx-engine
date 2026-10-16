import { describe, expect, it } from 'vitest';
import {
  configHash,
  defineCommands,
  rejectCommand,
  type SlotInfo,
} from '../../src/index.js';

const slot: SlotInfo = {
  slot: 0,
  team: 0,
  kind: 'human',
  playerId: 'local:0',
};

const commands = defineCommands(
  {
    move: {
      dx: 'i64',
      flag: 'bool',
      who: 'entity',
      n: 'i32',
      u: 'u32',
      b: 'u8',
      name: 'string',
    },
    note: { text: { type: 'string', maxLength: 4 } },
  },
  {
    validate: (command) =>
      command.type === 'note' && command.text === 'nope'
        ? rejectCommand('banned')
        : null,
  }
);

describe('defineCommands', () => {
  const move = {
    type: 'move' as const,
    dx: -7n,
    flag: true,
    who: 3,
    n: -1,
    u: 9,
    b: 255,
    name: 'a',
  };

  it('round-trips every field type', () => {
    const encoded = commands.encode(move);
    expect(encoded).toEqual({
      b: 255,
      dx: '-7',
      flag: true,
      n: -1,
      name: 'a',
      type: 'move',
      u: 9,
      who: 3,
    });
    expect(Object.keys(encoded as object)).toEqual([
      'b',
      'dx',
      'flag',
      'n',
      'name',
      'type',
      'u',
      'who',
    ]);
    expect(commands.decode(encoded, slot)).toEqual(move);
    expect(
      commands.decode(commands.encode({ type: 'note', text: 'ab' }), slot)
    ).toEqual({
      type: 'note',
      text: 'ab',
    });
  });

  it('rejects malformed input and does not throw', () => {
    const bad = [
      null,
      [],
      { dx: '1' },
      { type: 'other' },
      { type: 'move', dx: '1', extra: 1 },
      {
        type: 'move',
        dx: '01',
        flag: true,
        who: 0,
        n: 0,
        u: 0,
        b: 0,
        name: '',
      },
      { type: 'move', dx: '1', flag: 1, who: 0, n: 0, u: 0, b: 0, name: '' },
      {
        type: 'move',
        dx: '1',
        flag: true,
        who: -1,
        n: 0,
        u: 0,
        b: 0,
        name: '',
      },
      {
        type: 'move',
        dx: '1',
        flag: true,
        who: 0,
        n: 1.5,
        u: 0,
        b: 0,
        name: '',
      },
      { type: 'note', text: 'abcde' },
    ];
    for (const raw of bad) {
      const decoded = commands.decode(raw, slot);
      expect(decoded).toMatchObject({ rejected: true });
    }
    expect(
      commands.decode(
        {
          type: 'move',
          dx: '01',
          flag: true,
          who: 0,
          n: 0,
          u: 0,
          b: 0,
          name: '',
        },
        slot
      )
    ).toMatchObject({
      rejected: true,
      reason: "invalid field 'dx' (i64)",
    });
  });

  it('changes configHash when the command schema changes', () => {
    const other = defineCommands({ move: { dx: 'i32' } });
    expect(configHash({ seed: 1 }, undefined, commands.schema)).not.toBe(
      configHash({ seed: 1 }, undefined, other.schema)
    );
    expect(configHash({ seed: 1 }, undefined, [])).toBe(
      configHash({ seed: 1 })
    );
  });
});
