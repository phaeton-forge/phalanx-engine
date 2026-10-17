/**
 * XXH64 (seed 0) in BigInt. Reference and fallback for {@link digestBytes}.
 * Not a package export. Vectors match xxHash 0.8.2.
 */

const MASK64 = 0xffffffffffffffffn;
const PRIME64_1 = 0x9e3779b185ebca87n;
const PRIME64_2 = 0xc2b2ae3d27d4eb4fn;
const PRIME64_3 = 0x165667b19e3779f9n;
const PRIME64_4 = 0x85ebca77c2b2ae63n;
const PRIME64_5 = 0x27d4eb2f165667c5n;

export function xxh64BigInt(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('digestBytes: expected a Uint8Array');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  let offset = 0;
  let hash: bigint;

  if (len >= 32) {
    let v1 = u64(PRIME64_1 + PRIME64_2);
    let v2 = PRIME64_2;
    let v3 = 0n;
    let v4 = u64(0n - PRIME64_1);
    const limit = len - 32;
    while (offset <= limit) {
      v1 = round64(v1, view.getBigUint64(offset, true));
      offset += 8;
      v2 = round64(v2, view.getBigUint64(offset, true));
      offset += 8;
      v3 = round64(v3, view.getBigUint64(offset, true));
      offset += 8;
      v4 = round64(v4, view.getBigUint64(offset, true));
      offset += 8;
    }
    hash = u64(rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18));
    hash = mergeRound64(hash, v1);
    hash = mergeRound64(hash, v2);
    hash = mergeRound64(hash, v3);
    hash = mergeRound64(hash, v4);
  } else {
    hash = PRIME64_5;
  }

  hash = u64(hash + BigInt(len));

  while (offset + 8 <= len) {
    const lane = round64(0n, view.getBigUint64(offset, true));
    offset += 8;
    hash = u64(hash ^ lane);
    hash = u64(rotl64(hash, 27) * PRIME64_1 + PRIME64_4);
  }
  if (offset + 4 <= len) {
    hash = u64(hash ^ (BigInt(view.getUint32(offset, true)) * PRIME64_1));
    offset += 4;
    hash = u64(rotl64(hash, 23) * PRIME64_2 + PRIME64_3);
  }
  while (offset < len) {
    hash = u64(hash ^ (BigInt(view.getUint8(offset)) * PRIME64_5));
    offset += 1;
    hash = u64(rotl64(hash, 11) * PRIME64_1);
  }

  hash = avalanche64(hash);
  return hash.toString(16).padStart(16, '0');
}

function u64(value: bigint): bigint {
  return value & MASK64;
}

function rotl64(value: bigint, bits: number): bigint {
  const shift = BigInt(bits);
  return u64((value << shift) | (value >> (64n - shift)));
}

function round64(acc: bigint, input: bigint): bigint {
  let next = u64(acc + u64(input * PRIME64_2));
  next = rotl64(next, 31);
  return u64(next * PRIME64_1);
}

function mergeRound64(acc: bigint, val: bigint): bigint {
  const mixed = round64(0n, val);
  return u64((acc ^ mixed) * PRIME64_1 + PRIME64_4);
}

function avalanche64(hash: bigint): bigint {
  let next = u64(hash ^ (hash >> 33n));
  next = u64(next * PRIME64_2);
  next = u64(next ^ (next >> 29n));
  next = u64(next * PRIME64_3);
  next = u64(next ^ (next >> 32n));
  return next;
}
