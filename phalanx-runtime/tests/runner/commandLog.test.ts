import { describe, expect, it } from 'vitest';
import { CommandLog, type LogEntry } from '../../src/runner/CommandLog.js';

function entry(tick: number, playerId = 'local:0', seq = 0): LogEntry {
  return {
    tick,
    playerId,
    type: 'move',
    data: { q: seq, p: { type: 'move', dx: '1' } },
  };
}

describe('CommandLog', () => {
  it('records empty ticks and rejects a non-ascending append', () => {
    const log = new CommandLog();
    expect(log.lastTick).toBe(-1);
    expect(log.length).toBe(0);
    log.appendTick(0, []);
    expect(log.lastTick).toBe(0);
    expect(log.length).toBe(0);
    log.appendTick(1, [entry(1)]);
    expect(log.entriesAfter(0)).toEqual([entry(1)]);
    expect(() => log.appendTick(1, [])).toThrow(/not after/);
    expect(() => log.appendTick(2, [entry(3)])).toThrow(/does not match/);
  });

  it('truncates executed entries without moving lastTick', () => {
    const log = new CommandLog();
    log.appendTick(0, [entry(0)]);
    log.appendTick(1, [entry(1, 'local:0', 0), entry(1, 'bot:1', 0)]);
    log.appendTick(2, []);
    log.truncateThrough(1);
    expect(log.lastTick).toBe(2);
    expect(log.entriesAfter(-1)).toEqual([]);
    log.appendTick(3, [entry(3)]);
    expect(log.entriesAfter(2).map((item) => item.tick)).toEqual([3]);
  });

  it('marks a jumped rewind and a truncation as incomplete', () => {
    const log = new CommandLog();
    log.appendTick(0, [entry(0)]);
    log.appendTick(1, [entry(1)]);
    expect(log.isComplete).toBe(true);
    log.rewindTo(0);
    expect(log.isComplete).toBe(true);
    expect(log.lastTick).toBe(0);

    const restored = new CommandLog();
    restored.rewindTo(5);
    expect(restored.lastTick).toBe(5);
    expect(restored.isComplete).toBe(false);

    const truncated = new CommandLog();
    truncated.appendTick(0, [entry(0)]);
    truncated.appendTick(1, [entry(1)]);
    truncated.truncateThrough(0);
    expect(truncated.isComplete).toBe(false);
    truncated.rewindTo(-1);
    expect(truncated.isComplete).toBe(true);
    expect(truncated.lastTick).toBe(-1);
  });

  it('rewinds so the next append continues after the restored tick', () => {
    const log = new CommandLog();
    log.appendTick(0, [entry(0)]);
    log.appendTick(4, [entry(4)]);
    log.rewindTo(2);
    expect(log.lastTick).toBe(2);
    expect(log.length).toBe(1);
    log.appendTick(3, [entry(3)]);
    expect(log.lastTick).toBe(3);
    log.rewindTo(-1);
    expect(log.lastTick).toBe(-1);
    expect(log.length).toBe(0);
  });
});
