import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/config/validation.js';
import { DEFAULT_SESSION_TTL_MS } from '../src/config/defaults.js';
import { SessionTokens } from '../src/services/SessionTokens.js';
import type { SessionClaims } from '../src/services/SessionTokens.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const OTHER_SECRET = 'fedcba9876543210fedcba9876543210';
const NOW = 1_700_000_000_000;

function claims(): SessionClaims {
  return {
    matchId: 'match-1',
    playerId: 'player-1',
    slot: 0,
    exp: NOW + DEFAULT_SESSION_TTL_MS,
  };
}

function payloadPart(body: unknown): string {
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

function sign(payload: string, secret: string = SECRET): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function tokenFrom(body: unknown, secret: string = SECRET): string {
  const payload = payloadPart(body);
  return `${payload}.${sign(payload, secret)}`;
}

function readClaims(token: string): SessionClaims {
  const payload = token.split('.')[0];
  if (!payload) throw new Error('missing payload');
  return JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8')
  ) as SessionClaims;
}

describe('SessionTokens', () => {
  it('issues a token that verifies before exp', () => {
    const tokens = new SessionTokens({ secret: SECRET });
    const token = tokens.issue(
      { matchId: 'match-1', playerId: 'player-1', slot: 2 },
      NOW
    );
    const verified = tokens.verify(token, NOW + DEFAULT_SESSION_TTL_MS - 1);
    expect(verified).toEqual({
      ok: true,
      claims: {
        matchId: 'match-1',
        playerId: 'player-1',
        slot: 2,
        exp: NOW + DEFAULT_SESSION_TTL_MS,
      },
    });
    expect(readClaims(token).exp).toBe(NOW + DEFAULT_SESSION_TTL_MS);
  });

  it('uses a 60 minute ttl when ttlMs is omitted', () => {
    const tokens = new SessionTokens({ secret: SECRET });
    const token = tokens.issue({ matchId: 'm', playerId: 'p', slot: 0 }, NOW);
    expect(readClaims(token).exp - NOW).toBe(60 * 60 * 1000);
    expect(DEFAULT_SESSION_TTL_MS).toBe(60 * 60 * 1000);
  });

  it('honours ttlMs', () => {
    const tokens = new SessionTokens({ secret: SECRET, ttlMs: 5 });
    const token = tokens.issue({ matchId: 'm', playerId: 'p', slot: 0 }, NOW);
    expect(tokens.verify(token, NOW + 4)).toEqual({
      ok: true,
      claims: { matchId: 'm', playerId: 'p', slot: 0, exp: NOW + 5 },
    });
  });

  it('treats exp === nowMs as expired', () => {
    const tokens = new SessionTokens({ secret: SECRET });
    const token = tokens.issue(claims(), NOW);
    const exp = readClaims(token).exp;
    expect(tokens.verify(token, exp - 1).ok).toBe(true);
    expect(tokens.verify(token, exp)).toEqual({ ok: false, reason: 'expired' });
    expect(tokens.verify(token, exp + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a changed signature, a changed payload, and another secret', () => {
    const tokens = new SessionTokens({ secret: SECRET });
    const token = tokens.issue(claims(), NOW);
    const [payload, signature] = token.split('.');
    expect(payload).toBeDefined();
    expect(signature).toBeDefined();
    const flipped =
      signature!.slice(0, -1) + (signature!.endsWith('a') ? 'b' : 'a');
    expect(tokens.verify(`${payload}.${flipped}`, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });

    const rewritten = readClaims(token);
    rewritten.slot = 1;
    const tamperedPayload = payloadPart(rewritten);
    expect(tokens.verify(`${tamperedPayload}.${signature}`, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });

    const other = new SessionTokens({ secret: OTHER_SECRET });
    expect(other.verify(token, NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(tokens.verify(tokenFrom(claims(), OTHER_SECRET), NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('accepts a different JSON key order when the MAC covers that string', () => {
    const tokens = new SessionTokens({ secret: SECRET });
    const body = { exp: NOW + 10, slot: 1, playerId: 'p', matchId: 'm' };
    const token = tokenFrom(body);
    expect(tokens.verify(token, NOW)).toEqual({
      ok: true,
      claims: { matchId: 'm', playerId: 'p', slot: 1, exp: NOW + 10 },
    });
  });

  it('returns invalid for ten kinds of garbage and does not throw', () => {
    const tokens = new SessionTokens({ secret: SECRET });
    const signed = (body: unknown): string => tokenFrom(body);
    const garbage: unknown[] = [
      42,
      null,
      undefined,
      '',
      'no-dot',
      'a.b.c',
      '!!!.@@@',
      signed('not-json'),
      signed([1, 2, 3]),
      signed({ matchId: 'm', playerId: 'p', slot: '0', exp: NOW + 10 }),
    ];
    expect(garbage).toHaveLength(10);
    for (const value of garbage) {
      expect(() => tokens.verify(value, NOW)).not.toThrow();
      expect(tokens.verify(value, NOW)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
  });

  it('rejects missing fields and a truncated signature', () => {
    const tokens = new SessionTokens({ secret: SECRET });
    const missing = tokenFrom({ matchId: 'm', playerId: 'p', slot: 0 });
    expect(tokens.verify(missing, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const token = tokens.issue(claims(), NOW);
    const [payload, signature] = token.split('.');
    expect(tokens.verify(`${payload}.${signature!.slice(0, 8)}`, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('session config validation', () => {
  it('accepts a 32 character secret and rejects a shorter one', () => {
    expect(() => validateConfig({ session: { secret: SECRET } })).not.toThrow();
    expect(() => validateConfig({ session: { secret: 'short' } })).toThrow(
      /session\.secret/
    );
  });

  it('rejects a non-positive ttlMs and a non-boolean requireSessionToken', () => {
    expect(() =>
      validateConfig({ session: { secret: SECRET, ttlMs: 0 } })
    ).toThrow(/ttlMs/);
    expect(() =>
      validateConfig({ session: { secret: SECRET, ttlMs: 1.5 } })
    ).toThrow(/ttlMs/);
    expect(() =>
      validateConfig({
        session: { secret: SECRET },
        reconnect: { requireSessionToken: true },
      })
    ).not.toThrow();
    expect(() =>
      validateConfig({
        reconnect: { requireSessionToken: 'yes' as unknown as boolean },
      })
    ).toThrow(/requireSessionToken/);
  });

  it('leaves the feature off when session is omitted', () => {
    const config = validateConfig({});
    expect(config.session).toBeUndefined();
    expect(config.reconnect).toBeUndefined();
    expect(config.reconnectGracePeriodMs).toBe(30000);
  });
});
