import { createHmac, timingSafeEqual } from 'node:crypto';
import { DEFAULT_SESSION_TTL_MS } from '../config/defaults.js';

/** Claims inside a session token. `exp` is epoch milliseconds. */
export interface SessionClaims {
  matchId: string;
  playerId: string;
  slot: number;
  exp: number;
}

/** Claims supplied by the relay when a match issues a token. */
export interface SessionIssueClaims {
  matchId: string;
  playerId: string;
  slot: number;
}

export type SessionVerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: 'invalid' | 'expired' };

/**
 * How long an ended match stays answerable as `'match-ended'`
 * instead of `'invalid'`. Cleanup is a timer in `Phalanx`, not a tick.
 */
export const SESSION_TOMBSTONE_TTL_MS = 10 * 60 * 1000;

const SECRET_MIN_LENGTH = 32;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Stateless HMAC session tokens.
 *
 * Format: `base64url(JSON {matchId, playerId, slot, exp}) + '.' +
 * base64url(HMAC-SHA256(secret, payloadPart))`.
 * The MAC covers the payload string itself, not a re-serialized JSON
 * object, so key order cannot break a token this class issued.
 * The client treats the whole string as opaque.
 */
export class SessionTokens {
  private readonly secret: string;
  private readonly ttlMs: number;

  constructor(config: { secret: string; ttlMs?: number }) {
    if (
      typeof config.secret !== 'string' ||
      config.secret.length < SECRET_MIN_LENGTH
    ) {
      throw new Error(
        'session.secret must be a string of at least 32 characters'
      );
    }
    if (
      config.ttlMs !== undefined &&
      (!Number.isInteger(config.ttlMs) || config.ttlMs <= 0)
    ) {
      throw new Error('session.ttlMs must be an integer > 0');
    }
    this.secret = config.secret;
    this.ttlMs = config.ttlMs ?? DEFAULT_SESSION_TTL_MS;
  }

  /**
   * Issue a token. `exp` is the issue time plus `ttlMs`.
   * Callers pass `nowMs` in tests; production uses `Date.now()`.
   */
  issue(claims: SessionIssueClaims, nowMs: number = Date.now()): string {
    const body: SessionClaims = {
      matchId: claims.matchId,
      playerId: claims.playerId,
      slot: claims.slot,
      exp: nowMs + this.ttlMs,
    };
    const payloadPart = Buffer.from(JSON.stringify(body), 'utf8').toString(
      'base64url'
    );
    return `${payloadPart}.${this.sign(payloadPart)}`;
  }

  /**
   * Verify `token` at `nowMs`. Never throws.
   * A token is expired when `nowMs >= exp` (the `exp === nowMs` boundary
   * is expired). A bad signature is `'invalid'` even if `exp` has passed.
   */
  verify(token: unknown, nowMs: number): SessionVerifyResult {
    try {
      return this.verifyInner(token, nowMs);
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  }

  private verifyInner(token: unknown, nowMs: number): SessionVerifyResult {
    if (typeof token !== 'string') {
      return { ok: false, reason: 'invalid' };
    }
    const parts = token.split('.');
    if (parts.length !== 2) {
      return { ok: false, reason: 'invalid' };
    }
    const payloadPart = parts[0];
    const signaturePart = parts[1];
    if (
      payloadPart === undefined ||
      signaturePart === undefined ||
      !BASE64URL.test(payloadPart) ||
      !BASE64URL.test(signaturePart)
    ) {
      return { ok: false, reason: 'invalid' };
    }

    const expected = this.signBuffer(payloadPart);
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length) {
      return { ok: false, reason: 'invalid' };
    }
    if (!timingSafeEqual(actual, expected)) {
      return { ok: false, reason: 'invalid' };
    }

    const parsed: unknown = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8')
    );
    const claims = readClaims(parsed);
    if (!claims) {
      return { ok: false, reason: 'invalid' };
    }
    if (nowMs >= claims.exp) {
      return { ok: false, reason: 'expired' };
    }
    return { ok: true, claims };
  }

  private sign(payloadPart: string): string {
    return this.signBuffer(payloadPart).toString('base64url');
  }

  private signBuffer(payloadPart: string): Buffer {
    return createHmac('sha256', this.secret).update(payloadPart).digest();
  }
}

function readClaims(parsed: unknown): SessionClaims | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const matchId = record.matchId;
  const playerId = record.playerId;
  const slot = record.slot;
  const exp = record.exp;
  if (typeof matchId !== 'string' || matchId.length === 0) return null;
  if (typeof playerId !== 'string' || playerId.length === 0) return null;
  if (typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot < 0) {
    return null;
  }
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) return null;
  return { matchId, playerId, slot, exp };
}
