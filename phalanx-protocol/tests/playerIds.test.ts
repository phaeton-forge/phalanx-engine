import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BOT_PLAYER_ID_PREFIX,
  SYSTEM_PLAYER_ID,
  botPlayerId,
  isBotPlayerId,
} from '../src/playerIds.js';

describe('player ids', () => {
  it('uses the reserved system id and bot prefix', () => {
    expect(SYSTEM_PLAYER_ID).toBe('system');
    expect(BOT_PLAYER_ID_PREFIX).toBe('bot:');
  });

  it('builds a bot player id from a non-negative integer slot', () => {
    expect(botPlayerId(0)).toBe('bot:0');
    expect(botPlayerId(3)).toBe('bot:3');
  });

  it('rejects a slot that is not a non-negative integer', () => {
    expect(() => botPlayerId(-1)).toThrow(/non-negative integer/);
    expect(() => botPlayerId(1.5)).toThrow(/non-negative integer/);
    expect(() => botPlayerId(Number.NaN)).toThrow(/non-negative integer/);
  });

  it('recognises only canonical bot ids', () => {
    expect(isBotPlayerId('bot:0')).toBe(true);
    expect(isBotPlayerId('bot:12')).toBe(true);
    expect(isBotPlayerId('bot:03')).toBe(false);
    expect(isBotPlayerId('bot:')).toBe(false);
    expect(isBotPlayerId('bot:-1')).toBe(false);
    expect(isBotPlayerId('player-1')).toBe(false);
    expect(isBotPlayerId('system')).toBe(false);
  });
});

describe('package metadata', () => {
  it('is public at 0.3.1 with the contracts layer and no dependencies', () => {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      !('phalanx' in parsed) ||
      typeof parsed.version !== 'string'
    ) {
      throw new Error('package.json is missing version or phalanx');
    }
    expect('private' in parsed).toBe(false);
    expect(parsed.version).toBe('0.3.1');
    expect(parsed.phalanx).toEqual({ layer: 'contracts' });
    expect('dependencies' in parsed).toBe(false);
    expect('peerDependencies' in parsed).toBe(false);
    if (!('sideEffects' in parsed)) {
      throw new Error('package.json is missing sideEffects');
    }
    expect(parsed.sideEffects).toBe(false);
  });
});
