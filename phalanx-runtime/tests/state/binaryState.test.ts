import { describe, expect, it } from 'vitest';
import { BinaryStateReader, BinaryStateWriter } from '@phalanx-engine/ecs';

function written(fill: (w: BinaryStateWriter) => void): Uint8Array {
  const w = new BinaryStateWriter();
  fill(w);
  return w.finish();
}

function readBack<T>(bytes: Uint8Array, read: (r: BinaryStateReader) => T): T {
  const r = new BinaryStateReader(bytes);
  const value = read(r);
  r.done();
  return value;
}

describe('BinaryStateWriter / BinaryStateReader', () => {
  it('round-trips every primitive, including edges', () => {
    const bytes = written((w) => {
      w.u8(0);
      w.u8(255);
      w.u32(0);
      w.u32(0xffffffff);
      w.i32(-2147483648);
      w.i32(2147483647);
      w.varint(0);
      w.varint(127);
      w.varint(128);
      w.varint(300);
      w.varint(Number.MAX_SAFE_INTEGER);
      w.i64(-0x8000000000000000n);
      w.i64(-1n);
      w.i64(0n);
      w.i64(0x7fffffffffffffffn);
      w.bool(false);
      w.bool(true);
      w.str('');
      w.str('phalanx');
      w.str('é🎲');
      w.bytes(new Uint8Array());
      w.bytes(new Uint8Array([0, 255, 1]));
    });

    expect(
      readBack(bytes, (r) => ({
        u8a: r.u8(),
        u8b: r.u8(),
        u32a: r.u32(),
        u32b: r.u32(),
        i32a: r.i32(),
        i32b: r.i32(),
        v0: r.varint(),
        v127: r.varint(),
        v128: r.varint(),
        v300: r.varint(),
        vMax: r.varint(),
        i64min: r.i64(),
        i64neg: r.i64(),
        i64zero: r.i64(),
        i64max: r.i64(),
        bf: r.bool(),
        bt: r.bool(),
        empty: r.str(),
        ascii: r.str(),
        utf8: r.str(),
        noBytes: r.bytes(),
        someBytes: r.bytes(),
      }))
    ).toEqual({
      u8a: 0,
      u8b: 255,
      u32a: 0,
      u32b: 0xffffffff,
      i32a: -2147483648,
      i32b: 2147483647,
      v0: 0,
      v127: 127,
      v128: 128,
      v300: 300,
      vMax: Number.MAX_SAFE_INTEGER,
      i64min: -0x8000000000000000n,
      i64neg: -1n,
      i64zero: 0n,
      i64max: 0x7fffffffffffffffn,
      bf: false,
      bt: true,
      empty: '',
      ascii: 'phalanx',
      utf8: 'é🎲',
      noBytes: new Uint8Array(),
      someBytes: new Uint8Array([0, 255, 1]),
    });
  });

  it('writes fixed widths little-endian and LEB128 lengths', () => {
    expect([...written((w) => w.u32(0x01020304))]).toEqual([
      0x04, 0x03, 0x02, 0x01,
    ]);
    expect([...written((w) => w.i32(-1))]).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect([...written((w) => w.i64(1n))]).toEqual([
      0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect([...written((w) => w.i64(-1n))]).toEqual([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ]);
    expect([...written((w) => w.varint(0))]).toEqual([0x00]);
    expect([...written((w) => w.varint(127))]).toEqual([0x7f]);
    expect([...written((w) => w.varint(128))]).toEqual([0x80, 0x01]);
    expect([...written((w) => w.varint(300))]).toEqual([0xac, 0x02]);
    expect([...written((w) => w.varint(16384))]).toEqual([0x80, 0x80, 0x01]);
    expect([...written((w) => w.bool(true))]).toEqual([0x01]);
    expect([...written((w) => w.bool(false))]).toEqual([0x00]);
    expect([...written((w) => w.str('A'))]).toEqual([0x01, 0x41]);
    expect([...written((w) => w.str(''))]).toEqual([0x00]);
    // 'é' is 2 UTF-8 bytes, '🎲' is 4; the prefix is the byte length.
    expect([...written((w) => w.str('é🎲'))][0]).toBe(6);
    expect([...written((w) => w.bytes(new Uint8Array([0xab, 0xcd])))]).toEqual([
      0x02, 0xab, 0xcd,
    ]);
  });

  it('throws on out-of-range and wrongly typed values', () => {
    const w = new BinaryStateWriter();
    expect(() => w.u8(-1)).toThrow(/StateWriter\.u8/);
    expect(() => w.u8(256)).toThrow(/StateWriter\.u8/);
    expect(() => w.u8(1.5)).toThrow(/StateWriter\.u8/);
    expect(() => w.u8(Number.NaN)).toThrow(/StateWriter\.u8/);
    expect(() => w.u32(-1)).toThrow(/StateWriter\.u32/);
    expect(() => w.u32(2 ** 32)).toThrow(/StateWriter\.u32/);
    expect(() => w.i32(2 ** 31)).toThrow(/StateWriter\.i32/);
    expect(() => w.i32(-2147483649)).toThrow(/StateWriter\.i32/);
    expect(() => w.varint(-1)).toThrow(/StateWriter\.varint/);
    expect(() => w.varint(1.5)).toThrow(/StateWriter\.varint/);
    expect(() => w.varint(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /StateWriter\.varint/
    );
    expect(() => w.i64(1n << 63n)).toThrow(/outside int64/);
    expect(() => w.i64(-(1n << 63n) - 1n)).toThrow(/outside int64/);
    expect(() => w.i64(1 as unknown as bigint)).toThrow(/expected a bigint/);
    expect(() => w.bool('true' as unknown as boolean)).toThrow(/boolean/);
    expect(() => w.str(1 as unknown as string)).toThrow(/string/);
    expect(() => w.bytes([1] as unknown as Uint8Array)).toThrow(/Uint8Array/);
    expect(() => w.section('k', 1.5, () => {})).toThrow(/varint/);
    expect(() => new BinaryStateWriter(-1)).toThrow(/initialCapacity/);
    expect(() => new BinaryStateWriter(1.5)).toThrow(/initialCapacity/);
    expect(() => new BinaryStateReader(new ArrayBuffer(1) as never)).toThrow(
      /Uint8Array/
    );
  });

  it('rejects a bool that is not 0 or 1 and invalid UTF-8', () => {
    expect(() =>
      readBack(
        written((w) => w.u8(2)),
        (r) => r.bool()
      )
    ).toThrow(/expected 0 or 1/);
    expect(() =>
      readBack(
        written((w) => w.bytes(new Uint8Array([0xff]))),
        (r) => r.str()
      )
    ).toThrow(/invalid UTF-8/);
    expect(
      readBack(
        written((w) => w.str('ok')),
        (r) => r.str()
      )
    ).toBe('ok');
  });

  it('rejects unpaired UTF-16 surrogates and keeps valid pairs', () => {
    const w = new BinaryStateWriter();
    w.u8(1);
    expect(() => w.str('\uD800')).toThrow(/unpaired surrogate/);
    expect(() => w.str('\uDC00')).toThrow(/unpaired surrogate/);
    expect(() => w.str('a\uD800')).toThrow(/unpaired surrogate/);
    expect(() => w.str('\uDE00\uD83D')).toThrow(/unpaired surrogate/);
    expect([...w.finish()]).toEqual([1]);

    expect(
      readBack(
        written((writer) => writer.str('😀')),
        (r) => r.str()
      )
    ).toBe('😀');
    expect([...written((writer) => writer.str('a😀b'))]).toEqual([
      6, 0x61, 0xf0, 0x9f, 0x98, 0x80, 0x62,
    ]);
  });

  it('preserves a leading U+FEFF in strings and section keys', () => {
    const bom = '\uFEFFunits';
    expect(
      readBack(
        written((w) => w.str(bom)),
        (r) => r.str()
      )
    ).toBe(bom);
    expect(
      readBack(
        written((w) => {
          w.section(bom, 1, (s) => {
            s.u8(7);
          });
        }),
        (r) => r.section(bom, (s) => s.u8())
      )
    ).toBe(7);
  });

  it('rejects a non-canonical overlong varint', () => {
    expect(() =>
      new BinaryStateReader(new Uint8Array([0x80, 0x00])).varint()
    ).toThrow(/non-canonical encoding/);
    expect(
      readBack(
        written((w) => w.varint(128)),
        (r) => r.varint()
      )
    ).toBe(128);
  });

  it('rejects a varint above 2^53-1', () => {
    // 9-byte continuation cannot be a safe integer.
    const overlong = written((w) => {
      for (let i = 0; i < 9; i += 1) w.u8(0x80);
    });
    expect(() => new BinaryStateReader(overlong).varint()).toThrow(
      /exceeds 2\^53-1/
    );
  });

  it('reads a view with a non-zero byteOffset', () => {
    const payload = written((w) => w.u32(0x11223344));
    const padded = new Uint8Array(4 + payload.length);
    padded.set(payload, 4);
    expect(readBack(padded.subarray(4), (r) => r.u32())).toBe(0x11223344);
  });

  it('rejects a list or sortedBy count that cannot fit in the remaining bytes', () => {
    const bytes = written((w) => {
      w.varint(3);
      w.u8(1);
    });
    expect(() => new BinaryStateReader(bytes).list((r) => r.u8())).toThrow(
      /count 3 exceeds 1 remaining byte/
    );
  });

  it('keeps list order and reports indexes', () => {
    const bytes = written((w) => {
      w.list([3, 1, 2], (n, iw) => {
        iw.u8(n);
      });
    });
    expect(
      readBack(bytes, (r) => r.list((ir, index) => ({ index, n: ir.u8() })))
    ).toEqual([
      { index: 0, n: 3 },
      { index: 1, n: 1 },
      { index: 2, n: 2 },
    ]);
    expect(
      readBack(
        written((w) => w.list([], () => {})),
        (r) => r.list(() => 1)
      )
    ).toEqual([]);
  });

  it('sortedBy order does not depend on input order', () => {
    const write = (items: Iterable<number>): Uint8Array =>
      written((w) => {
        w.sortedBy(
          items,
          (n) => n,
          (n, iw) => {
            iw.i32(n);
          }
        );
      });
    const forward = write([1, 2, 3]);
    const backward = write([3, 1, 2]);
    const fromSet = write(new Set([3, 1, 2]));
    function* gen(): Generator<number> {
      yield 2;
      yield 10;
      yield 1;
    }
    expect(forward).toEqual(backward);
    expect(forward).toEqual(fromSet);
    expect(readBack(forward, (r) => r.list((ir) => ir.i32()))).toEqual([
      1, 2, 3,
    ]);
    expect(readBack(write(gen()), (r) => r.list((ir) => ir.i32()))).toEqual([
      1, 2, 10,
    ]);
    expect(
      readBack(
        written((w) => {
          w.sortedBy(
            [-1, -5, 3],
            (n) => n,
            (n, iw) => {
              iw.i32(n);
            }
          );
        }),
        (r) => r.list((ir) => ir.i32())
      )
    ).toEqual([-5, -1, 3]);
    expect(
      readBack(
        written((w) =>
          w.sortedBy(
            [],
            () => 0,
            () => {}
          )
        ),
        (r) => r.list(() => 0)
      )
    ).toEqual([]);
  });

  it('sortedBy throws on duplicate and non-integer keys without writing', () => {
    const w = new BinaryStateWriter();
    w.u8(9);
    expect(() =>
      w.sortedBy(
        [1, 2, 1],
        (n) => n,
        () => {}
      )
    ).toThrow(/duplicate key 1/);
    expect(() =>
      w.sortedBy(
        [1.5],
        (n) => n,
        () => {}
      )
    ).toThrow(/key must be an integer/);
    expect(() =>
      w.sortedBy(
        [Number.NaN],
        (n) => n,
        () => {}
      )
    ).toThrow(/key must be an integer/);
    expect(readBack(w.finish(), (r) => r.u8())).toBe(9);
  });

  it('sections round-trip and isolate the following bytes', () => {
    const bytes = written((w) => {
      w.section('units', 2, (s) => {
        s.u8(4);
        s.section('hp', 1, (inner) => {
          inner.u32(9);
        });
      });
      w.u8(7);
    });
    expect([...bytes]).toEqual([
      0x05,
      ...new TextEncoder().encode('units'),
      0x02,
      0x0a,
      0x04,
      0x02,
      ...new TextEncoder().encode('hp'),
      0x01,
      0x04,
      0x09,
      0x00,
      0x00,
      0x00,
      0x07,
    ]);
    expect(
      readBack(bytes, (r) => {
        const value = r.section('units', (s, version) => {
          expect(version).toBe(2);
          const flag = s.u8();
          const hp = s.section('hp', (inner, innerVersion) => {
            expect(innerVersion).toBe(1);
            return inner.u32();
          });
          return { flag, hp };
        });
        return { value, tail: r.u8() };
      })
    ).toEqual({ value: { flag: 4, hp: 9 }, tail: 7 });
  });

  it('throws when a section key does not match', () => {
    const bytes = written((w) => {
      w.section('units', 1, (s) => {
        s.u8(1);
      });
    });
    expect(() =>
      new BinaryStateReader(bytes).section('other', () => undefined)
    ).toThrow(/expected key 'other', found 'units'/);
  });

  it('throws when a section body is not fully consumed', () => {
    const bytes = written((w) => {
      w.section('units', 1, (s) => {
        s.u8(1);
        s.u8(2);
      });
    });
    expect(() =>
      new BinaryStateReader(bytes).section('units', (r) => r.u8())
    ).toThrow(/section 'units' left 1 unread byte/);
  });

  it('does not publish a section when the body callback throws', () => {
    const w = new BinaryStateWriter();
    w.u8(1);
    expect(() =>
      w.section('k', 1, (s) => {
        s.u8(2);
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(readBack(w.finish(), (r) => r.u8())).toBe(1);
  });

  it('writes a canonical in-place section length', () => {
    for (const bodyLength of [0, 1, 200]) {
      const viaSection = new BinaryStateWriter();
      viaSection.section('k', 1, (section) => {
        for (let index = 0; index < bodyLength; index += 1) {
          section.u8(index & 0xff);
        }
      });
      const manual = new BinaryStateWriter();
      manual.str('k');
      manual.varint(1);
      manual.varint(bodyLength);
      for (let index = 0; index < bodyLength; index += 1) {
        manual.u8(index & 0xff);
      }
      expect(viaSection.finish()).toEqual(manual.finish());
    }
  });

  it('reuses a writer buffer after reset', () => {
    const writer = new BinaryStateWriter();
    writer.str('again');
    const first = writer.finish();
    writer.reset();
    expect(writer.finish()).toEqual(new Uint8Array());
    writer.str('again');
    expect(writer.finish()).toEqual(first);
  });

  it('round-trips a string longer than the utf-8 cache and rejects its surrogate', () => {
    const long = 'n'.repeat(200);
    const writer = new BinaryStateWriter();
    writer.str(long);
    writer.str(long);
    const reader = new BinaryStateReader(writer.finish());
    expect(reader.str()).toBe(long);
    expect(reader.str()).toBe(long);

    const bad = new BinaryStateWriter();
    const unpaired = `${'n'.repeat(200)}\uD800`;
    expect(() => bad.str(unpaired)).toThrow(/unpaired surrogate/);
    expect(() => bad.str(unpaired)).toThrow(/unpaired surrogate/);
    expect(bad.finish()).toEqual(new Uint8Array());
  });

  it('round-trips more strings than the utf-8 cache and rejects a bad surrogate twice', () => {
    const writer = new BinaryStateWriter();
    const values = Array.from(
      { length: 5000 },
      (_, index) => `Tag.Ability.${String(index)}`
    );
    for (const value of values) writer.str(value);
    const reader = new BinaryStateReader(writer.finish());
    for (const value of values) expect(reader.str()).toBe(value);

    const bad = new BinaryStateWriter();
    const unpaired = 'a\uD800b';
    expect(() => bad.str(unpaired)).toThrow(/unpaired surrogate/);
    expect(() => bad.str(unpaired)).toThrow(/unpaired surrogate/);
    expect(bad.finish()).toEqual(new Uint8Array());
  });

  it('done() throws when unread bytes remain', () => {
    const bytes = written((w) => {
      w.u8(1);
      w.u8(2);
    });
    const r = new BinaryStateReader(bytes);
    expect(r.u8()).toBe(1);
    expect(() => r.done()).toThrow(/1 unread byte/);
    expect(r.u8()).toBe(2);
    r.done();
    expect(() => new BinaryStateReader(new Uint8Array()).done()).not.toThrow();
    expect(() => new BinaryStateReader(bytes).u32()).toThrow(
      /unexpected end of buffer/
    );
  });

  it('two writers given the same calls produce identical bytes', () => {
    const fill = (w: BinaryStateWriter): void => {
      w.u8(7);
      w.u32(0xffffffff);
      w.i32(-1);
      w.varint(300);
      w.i64(-1n);
      w.bool(true);
      w.str('phalanx');
      w.bytes(new Uint8Array([9, 8]));
      w.section('units', 2, (s) => {
        s.list([2, 1], (n, iw) => {
          iw.u32(n);
        });
      });
      w.sortedBy(
        [
          { id: 2, n: 1 },
          { id: 1, n: 2 },
        ],
        (t) => t.id,
        (t, iw) => {
          iw.u32(t.id);
          iw.u32(t.n);
        }
      );
    };
    const small = new BinaryStateWriter(0);
    const large = new BinaryStateWriter(256);
    fill(small);
    fill(large);
    const a = small.finish();
    const b = large.finish();
    expect(a).toEqual(b);
    expect(small.finish()).toEqual(a);
    expect(
      readBack(a, (r) => {
        expect(r.u8()).toBe(7);
        expect(r.u32()).toBe(0xffffffff);
        expect(r.i32()).toBe(-1);
        expect(r.varint()).toBe(300);
        expect(r.i64()).toBe(-1n);
        expect(r.bool()).toBe(true);
        expect(r.str()).toBe('phalanx');
        expect(r.bytes()).toEqual(new Uint8Array([9, 8]));
        expect(r.section('units', (s) => s.list((ir) => ir.u32()))).toEqual([
          2, 1,
        ]);
        return r.list((ir) => ({ id: ir.u32(), n: ir.u32() }));
      })
    ).toEqual([
      { id: 1, n: 2 },
      { id: 2, n: 1 },
    ]);
  });

  it('has no float methods', () => {
    expect('f32' in BinaryStateWriter.prototype).toBe(false);
    expect('f64' in BinaryStateWriter.prototype).toBe(false);
    expect('f32' in BinaryStateReader.prototype).toBe(false);
    expect('f64' in BinaryStateReader.prototype).toBe(false);
  });
});
