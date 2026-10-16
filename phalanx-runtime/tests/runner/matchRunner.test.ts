import { afterEach, describe, expect, it } from 'vitest';
import type {
  CommandsBatch,
  FrameHandler,
  TickHandler,
  Unsubscribe,
} from '@phalanx-engine/ecs';
import {
  LocalTransport,
  MatchRunner,
  SnapshotRoundTripError,
  botPlayerId,
  type Digest,
  type SnapshotBytes,
  type Transport,
} from '../../src/index.js';
import { decodeSnapshot } from '../../src/state/snapshot.js';
import { decodeInputCheckpoint } from '../../src/runner/InputCheckpoint.js';
import { DeterministicRandom } from '@phalanx-engine/math';
import {
  TinyGame,
  resetTinyBotCalls,
  setTinyBotBoom,
  setTinyCreateDraw,
  setTinyDecodeBoom,
  setTinyRestoreBroken,
  setTinyTickBoom,
  setTinyValidateBoom,
  tinyBotCalls,
  tinyCommandsProto,
  tinyCreateStates,
  type TinyCommand,
  type TinyConfig,
  type TinySim,
} from '../fixtures/tinyGame.js';

const DELAY = 2;
const ARENA = 2_000_000_000;

interface Drive {
  readonly runner: MatchRunner<typeof TinyGame>;
  readonly transport: LocalTransport;
}

const live: MatchRunner<typeof TinyGame>[] = [];

function configFor(side: 'client' | 'server', seed = 7): TinyConfig {
  return {
    matchId: 'm',
    gameId: 'tiny',
    simVersion: 'tiny-1',
    seed,
    simMode: side,
    inputDelayTicks: DELAY,
    arenaSize: ARENA,
    slots: [
      { slot: 0, team: 0, kind: 'human', playerId: 'local:0', color: 1 },
      {
        slot: 1,
        team: 1,
        kind: 'bot',
        policy: 'walker',
        level: 1,
        runsOn: side === 'server' ? 'server' : 'local',
        color: 2,
      },
    ],
  };
}

function drive(
  simMode: 'client' | 'server' = 'client',
  seed = 7,
  side: 'client' | 'server' = simMode
): Drive {
  const transport = LocalTransport.manual();
  const runner = new MatchRunner(
    TinyGame,
    configFor(simMode, seed),
    transport,
    { side }
  );
  live.push(runner);
  return { runner, transport };
}

function stepTo(driveHandle: Drive, tick: number): void {
  const left = tick - driveHandle.runner.tick;
  if (left < 0)
    throw new Error(`already at ${String(driveHandle.runner.tick)}`);
  driveHandle.transport.step(left);
}

function botX(sim: TinySim): bigint | undefined {
  return sim.unitBySlot(1)?.x;
}

function encoded(command: TinyCommand): {
  type: string;
  x?: string;
  dx?: string;
} {
  return command.type === 'spawn'
    ? { type: 'spawn', x: command.x.toString() }
    : { type: 'move', dx: command.dx.toString() };
}

class ScriptedTransport implements Transport {
  public readonly kind = 'relay-lockstep' as const;
  private readonly ticks: TickHandler[] = [];
  private readonly frames: FrameHandler[] = [];
  public onSubmit:
    | ((
        tick: number,
        slot: number,
        commands: readonly { type: string; data?: unknown }[]
      ) => void)
    | null = null;

  public onTick(handler: TickHandler): Unsubscribe {
    this.ticks.push(handler);
    return () => {
      const index = this.ticks.indexOf(handler);
      if (index !== -1) this.ticks.splice(index, 1);
    };
  }

  public onFrame(handler: FrameHandler): Unsubscribe {
    this.frames.push(handler);
    return () => {
      const index = this.frames.indexOf(handler);
      if (index !== -1) this.frames.splice(index, 1);
    };
  }

  public submit(
    tick: number,
    slot: number,
    commands: readonly { type: string; data?: unknown }[]
  ): void {
    this.onSubmit?.(tick, slot, commands);
  }

  public emitTick(tick: number, batch: CommandsBatch): void {
    for (const handler of this.ticks.slice()) handler(tick, batch);
  }

  public emitFrame(alpha: number, dt: number): void {
    for (const handler of this.frames.slice()) handler(alpha, dt);
  }
}

describe('MatchRunner', () => {
  afterEach(() => {
    setTinyRestoreBroken(false);
    setTinyDecodeBoom(false);
    setTinyValidateBoom(false);
    setTinyTickBoom(false);
    setTinyBotBoom(false);
    setTinyCreateDraw(false);
    tinyCreateStates.length = 0;
    resetTinyBotCalls();
    while (live.length > 0) live.pop()?.dispose();
  });

  it('rejects an invalid command inside the tick and again on replay', () => {
    const first = drive();
    const reasons: string[] = [];
    first.runner.onRejected((_entry, reason) => {
      reasons.push(reason);
    });
    first.runner.submit({ type: 'move', dx: 1n });
    first.runner.submit({ type: 'spawn', x: 4n });
    first.runner.start();
    stepTo(first, 4);
    first.runner.submit({ type: 'spawn', x: 8n });
    stepTo(first, 8);
    expect(reasons).toEqual(['no unit', 'slot occupied', 'slot occupied']);
    expect(first.runner.sim.unitBySlot(0)?.x).toBe(4n);
    const rejected = first.runner.log
      .entriesAfter(-1)
      .filter((entry) => entry.playerId === 'local:0' && entry.type === 'move');
    expect(rejected).toHaveLength(1);

    const replay = first.runner.toReplay();
    resetTinyBotCalls();
    const second = MatchRunner.fromReplay(TinyGame, replay);
    live.push(second);
    const again: string[] = [];
    second.onRejected((_entry, reason) => {
      again.push(reason);
    });
    return second
      .fastForward(replay.log, { budgetMs: 50, throughTick: replay.lastTick })
      .then(() => {
        expect(again).toEqual(reasons);
        expect(second.digest()).toBe(replay.finalDigest);
        expect(tinyBotCalls).toEqual([]);
      });
  });

  it('logs bot commands at the decision tick plus the input delay', () => {
    const handle = drive();
    handle.runner.start();
    stepTo(handle, 6);
    expect(tinyBotCalls[0]?.tick).toBe(0);
    const botId = botPlayerId(1);
    for (const call of tinyBotCalls) {
      const target = call.tick + DELAY;
      if (target > handle.runner.tick) continue;
      const logged = handle.runner.log
        .entriesAfter(target - 1)
        .filter((entry) => entry.tick === target && entry.playerId === botId);
      expect(logged.map((entry) => entry.data.p)).toEqual(
        call.commands.map((command) => encoded(command))
      );
    }
    const atDecision = handle.runner.log
      .entriesAfter(-1)
      .filter((entry) => entry.tick === 0 && entry.playerId === botId);
    expect(atDecision).toEqual([]);
    const firstExecution = handle.runner.log
      .entriesAfter(-1)
      .filter((entry) => entry.tick === DELAY && entry.playerId === botId);
    expect(firstExecution.length).toBeGreaterThan(0);
  });

  it('orders a tick by slot then seq, and drops unknown player ids', () => {
    const handle = drive();
    handle.runner.start();
    handle.transport.submit(0, 0, [
      { type: 'spawn', data: { q: 1, p: { type: 'spawn', x: '9' } } },
      { type: 'spawn', data: { q: 0, p: { type: 'spawn', x: '5' } } },
    ]);
    handle.transport.step(1);
    const human = handle.runner.log
      .entriesAfter(-1)
      .filter((entry) => entry.playerId === 'local:0');
    expect(human.map((entry) => entry.data.q)).toEqual([0, 1]);
    expect(handle.runner.sim.unitBySlot(0)?.x).toBe(5n);

    const scripted = new ScriptedTransport();
    const runner = new MatchRunner(TinyGame, configFor('client'), scripted, {
      localSlots: [0],
    });
    live.push(runner);
    runner.start();
    scripted.emitTick(0, {
      tick: 0,
      commands: {
        stranger: [
          {
            type: 'spawn',
            data: { q: 0, p: { type: 'spawn', x: '1' } },
            playerId: 'stranger',
          },
        ],
        'local:0': [
          {
            type: 'spawn',
            data: { q: 0, p: { type: 'spawn', x: '2' } },
            playerId: 'local:0',
          },
        ],
      },
    });
    expect(runner.log.entriesAfter(-1).map((entry) => entry.playerId)).toEqual([
      'local:0',
    ]);
    const reasons: string[] = [];
    runner.onRejected((_entry, reason) => {
      reasons.push(reason);
    });
    scripted.emitTick(1, {
      tick: 1,
      commands: {
        'local:0': [{ type: 'move', data: { q: 'nope' }, playerId: 'local:0' }],
      },
    });
    expect(reasons).toEqual(['malformed envelope']);
    expect(runner.tick).toBe(1);
    expect(runner.log.entriesAfter(0).some((entry) => entry.malformed)).toBe(
      true
    );
    scripted.emitTick(2, { tick: 2, commands: {} });
    expect(runner.tick).toBe(2);
    expect(runner.status).toBe('running');
  });

  it('pauses the transport so a step does not advance the world', () => {
    const handle = drive();
    handle.runner.start();
    stepTo(handle, 2);
    const tick = handle.runner.tick;
    const hp = handle.runner.sim.unitBySlot(1)?.hp;
    handle.runner.sim.world.pause();
    handle.transport.step(3);
    expect(handle.runner.tick).toBe(tick);
    expect(handle.runner.sim.unitBySlot(1)?.hp).toBe(hp);
    handle.runner.sim.world.resume();
    handle.transport.step(1);
    expect(handle.runner.tick).toBe(tick + 1);
  });

  it('keeps entity ids isolated across interleaved runners', () => {
    const left = drive('client', 1);
    const right = drive('client', 2);
    left.runner.submit({ type: 'spawn', x: 4n });
    right.runner.submit({ type: 'spawn', x: 8n });
    left.runner.start();
    right.runner.start();
    left.transport.step(2);
    right.transport.step(2);
    left.transport.step(1);
    right.transport.step(1);
    expect(left.runner.sim.unitBySlot(0)?.id).toBe(1);
    expect(right.runner.sim.unitBySlot(0)?.id).toBe(1);
    expect(left.runner.sim.unitBySlot(0)?.x).toBe(4n);
    expect(right.runner.sim.unitBySlot(0)?.x).toBe(8n);
  });

  it('reaches progress 1 and suppresses frames while fast-forwarding', async () => {
    const scripted = new ScriptedTransport();
    const runner = new MatchRunner(TinyGame, configFor('client'), scripted, {
      localSlots: [0],
    });
    live.push(runner);
    const progress: number[] = [];
    let frames = 0;
    runner.onFrame(() => {
      frames += 1;
    });
    runner.onCatchUp(() => {
      scripted.emitFrame(0.25, 0.01);
    });
    await runner.fastForward([], {
      budgetMs: 0,
      throughTick: 5,
      onProgress: (value) => {
        progress.push(value);
      },
    });
    expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBe(6);
    expect(progress[0]).toBe(1 / 6);
    expect(frames).toBe(0);
    expect(runner.tick).toBe(5);
    scripted.emitFrame(0.5, 0.01);
    expect(frames).toBe(0);
    runner.start();
    scripted.emitFrame(0.5, 0.01);
    expect(frames).toBe(1);
  });

  it('throws SnapshotRoundTripError when restore does not re-save', () => {
    const handle = drive();
    handle.runner.submit({ type: 'spawn', x: 3n });
    handle.runner.start();
    stepTo(handle, 4);
    const bytes = handle.runner.snapshot();
    const restored = drive();
    setTinyRestoreBroken(true);
    expect(() => restored.runner.restore(bytes)).toThrow(
      SnapshotRoundTripError
    );
  });

  it('replays 1000 ticks of human and bot commands without deciding', async () => {
    const handle = drive();
    handle.runner.submit({ type: 'spawn', x: 3n });
    handle.runner.onTick((tick) => {
      if (tick % 20 === 0) handle.runner.submit({ type: 'move', dx: 1n });
    });
    handle.runner.start();
    stepTo(handle, 1000);
    const replay = handle.runner.toReplay();
    const finalDigest = handle.runner.digest();
    expect(replay.finalDigest).toBe(finalDigest);
    expect(replay.lastTick).toBe(1000);
    resetTinyBotCalls();
    const replayed = MatchRunner.fromReplay(TinyGame, replay);
    live.push(replayed);
    await replayed.fastForward(replay.log, {
      budgetMs: 50,
      throughTick: replay.lastTick,
    });
    expect(tinyBotCalls).toEqual([]);
    expect(replayed.digest()).toBe(finalDigest);
    expect(replayed.tick).toBe(1000);
  });

  it('restores at tick 500 and matches every later digest through 1000', async () => {
    const handle = drive('server', 11);
    const hashes = new Map<number, Digest>();
    let snapshot: SnapshotBytes | undefined;
    handle.runner.onTick((tick) => {
      hashes.set(tick, handle.runner.digest());
      if (tick === 500) snapshot = handle.runner.snapshot();
    });
    handle.runner.submit({ type: 'spawn', x: 3n });
    handle.runner.start();
    stepTo(handle, 1000);
    if (snapshot === undefined) throw new Error('missing snapshot');
    const saved = snapshot;

    const restored = drive('server', 11);
    const tail = handle.runner.log
      .entriesAfter(500)
      .filter((entry) => entry.tick <= 1000);
    restored.runner.restore(saved);
    expect(restored.runner.digest()).toBe(hashes.get(500));
    const again = new Map<number, Digest>();
    restored.runner.onTick((tick) => {
      again.set(tick, restored.runner.digest());
    });
    await restored.runner.fastForward(tail, {
      budgetMs: 50,
      throughTick: 1000,
    });
    for (let tick = 501; tick <= 1000; tick += 1) {
      expect(again.get(tick)).toBe(hashes.get(tick));
    }
  });

  it('resumes an empty tail with the checkpoint, and ignores it on a client', async () => {
    const server = drive('server', 9);
    let snapshot: SnapshotBytes | undefined;
    server.runner.onTick((tick) => {
      if (tick === 10) snapshot = server.runner.snapshot();
    });
    server.runner.submit({ type: 'spawn', x: 6n });
    server.runner.start();
    stepTo(server, 15);
    const expectedX = botX(server.runner.sim);
    const expectedDigest = server.runner.digest();
    if (snapshot === undefined) throw new Error('missing snapshot');
    const saved = snapshot;

    const resumed = drive('server', 9);
    resumed.runner.restore(saved);
    await resumed.runner.fastForward([], {
      budgetMs: 1,
      throughTick: resumed.runner.tick,
    });
    resumed.runner.start();
    stepTo(resumed, 15);
    expect(botX(resumed.runner.sim)).toBe(expectedX);
    expect(resumed.runner.digest()).toBe(expectedDigest);

    resetTinyBotCalls();
    const client = drive('server', 9, 'client');
    client.runner.restore(saved);
    client.runner.start();
    stepTo(client, 15);
    expect(botX(client.runner.sim)).not.toBe(expectedX);
    expect(tinyBotCalls).toEqual([]);
  });

  it('matches the next live decision after a log tail past the snapshot', async () => {
    const continuous = drive('server', 4);
    const calls: { tick: number; commands: readonly TinyCommand[] }[] = [];
    const digests = new Map<number, Digest>();
    let snapshot: SnapshotBytes | undefined;
    continuous.runner.onTick((tick) => {
      digests.set(tick, continuous.runner.digest());
      if (tick === 40) snapshot = continuous.runner.snapshot();
    });
    continuous.runner.submit({ type: 'spawn', x: 2n });
    continuous.runner.start();
    stepTo(continuous, 100);
    for (const call of tinyBotCalls) calls.push(call);
    if (snapshot === undefined) throw new Error('missing snapshot');
    const saved = snapshot;
    const tail = continuous.runner.log
      .entriesAfter(40)
      .filter((entry) => entry.tick <= 90);

    resetTinyBotCalls();
    const resumed = drive('server', 4);
    resumed.runner.restore(saved);
    await resumed.runner.fastForward(tail, {
      budgetMs: 20,
      throughTick: 90,
    });
    resumed.runner.start();
    stepTo(resumed, 91);
    expect(tinyBotCalls).toEqual(
      calls.filter((call) => call.tick > 40 && call.tick <= 91)
    );
    expect(resumed.runner.digest()).toBe(digests.get(91));
  });

  it('rejects a malformed envelope and a throwing decode or validate', () => {
    const decode = drive();
    const reasons: string[] = [];
    decode.runner.onRejected((_entry, reason) => {
      reasons.push(reason);
    });
    setTinyDecodeBoom(true);
    decode.runner.submit({ type: 'spawn', x: 1n });
    decode.runner.start();
    stepTo(decode, 2);
    expect(reasons).toEqual(['decode exploded', 'decode exploded']);
    expect(decode.runner.sim.unitBySlot(0)).toBeNull();
    expect(decode.runner.status).toBe('running');
    setTinyDecodeBoom(false);

    const validate = drive('client', 3);
    const validateReasons: string[] = [];
    validate.runner.onRejected((_entry, reason) => {
      validateReasons.push(reason);
    });
    setTinyValidateBoom(true);
    validate.runner.submit({ type: 'spawn', x: 1n });
    validate.runner.start();
    stepTo(validate, 2);
    expect(validateReasons).toContain('validate exploded');
    expect(validate.runner.status).toBe('running');
  });

  it('fails the runner and stops when a tick throws', () => {
    const handle = drive();
    const errors: { tick: number; message: string }[] = [];
    handle.runner.onError((error, tick) => {
      errors.push({
        tick,
        message: error instanceof Error ? error.message : '',
      });
    });
    handle.runner.start();
    setTinyTickBoom(true);
    handle.transport.step(1);
    expect(handle.runner.status).toBe('failed');
    expect(handle.runner.tick).toBe(-1);
    expect(errors).toEqual([{ tick: 0, message: 'tick exploded' }]);
    setTinyTickBoom(false);
    handle.transport.step(2);
    expect(handle.runner.tick).toBe(-1);
    expect(() => handle.runner.start()).toThrow(/failed/);
  });

  it('logs a bot decide error and still finishes the tick', () => {
    const handle = drive();
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      setTinyBotBoom(true);
      handle.runner.start();
      handle.transport.step(1);
    } finally {
      console.error = original;
    }
    expect(handle.runner.status).toBe('running');
    expect(handle.runner.tick).toBe(0);
    expect(tinyBotCalls).toEqual([]);
    expect(logged.length).toBeGreaterThan(0);
  });

  it('emits outcome once and stops', () => {
    const transport = LocalTransport.manual();
    const runner = new MatchRunner(
      TinyGame,
      { ...configFor('client', 1), arenaSize: 1 },
      transport
    );
    live.push(runner);
    const outcomes: string[] = [];
    runner.onOutcome((outcome) => {
      outcomes.push(outcome.kind);
    });
    runner.submit({ type: 'spawn', x: 1n });
    runner.start();
    stepTo({ runner, transport }, 4);
    expect(outcomes).toEqual(['win']);
    expect(runner.status).toBe('ended');
    expect(runner.tick).toBe(1);
    transport.step(3);
    expect(runner.tick).toBe(1);
    expect(outcomes).toEqual(['win']);
  });

  it('stores canonical payloads so a restored log matches the live log', () => {
    const liveRun = drive('client', 5);
    liveRun.runner.submit({ type: 'spawn', x: 3n });
    liveRun.runner.start();
    stepTo(liveRun, 1);
    liveRun.runner.submit({ type: 'move', dx: 4n });
    const snapshot = liveRun.runner.snapshot();
    stepTo(liveRun, 4);
    const move = liveRun.runner.log
      .entriesAfter(-1)
      .find((entry) => entry.type === 'move' && entry.playerId === 'local:0');
    expect(move).toBeDefined();
    expect(Object.keys(move?.data.p ?? {})).toEqual(['dx', 'type']);

    const restored = drive('client', 5);
    restored.runner.restore(snapshot);
    restored.runner.start();
    stepTo(restored, 4);
    expect(JSON.stringify(restored.runner.log.entriesAfter(1))).toBe(
      JSON.stringify(liveRun.runner.log.entriesAfter(1))
    );
  });

  it('flushes checkpoint commands when restore happens after start', () => {
    const handle = drive();
    handle.runner.start();
    stepTo(handle, 1);
    handle.runner.submit({ type: 'spawn', x: 5n });
    const snapshot = handle.runner.snapshot();
    handle.runner.restore(snapshot);
    stepTo(handle, 1 + DELAY);
    expect(handle.runner.sim.unitBySlot(0)?.x).toBe(5n);
  });

  it('applies transport batches that arrive past the catch-up range', async () => {
    const scripted = new ScriptedTransport();
    const runner = new MatchRunner(TinyGame, configFor('client', 4), scripted);
    live.push(runner);
    const seen: number[] = [];
    runner.onTick((tick) => {
      seen.push(tick);
      if (tick === 0) {
        scripted.emitTick(1, { tick: 1, commands: {} });
        scripted.emitTick(3, { tick: 3, commands: {} });
        scripted.emitTick(2, { tick: 2, commands: {} });
      }
    });
    runner.start();
    await runner.fastForward([], { budgetMs: 1000, throughTick: 1 });
    expect(runner.tick).toBe(3);
    expect(seen).toEqual([0, 1, 2, 3]);
  });

  it('keeps local ticks that arrive after the catch-up range', async () => {
    const handle = drive();
    handle.runner.onTick((tick) => {
      if (tick === 0) handle.transport.step(2);
    });
    handle.runner.start();
    await handle.runner.fastForward([], { budgetMs: 1000, throughTick: 0 });
    expect(handle.runner.tick).toBe(2);
  });

  it('rejects pause when the transport cannot pause', () => {
    const scripted = new ScriptedTransport();
    const runner = new MatchRunner(TinyGame, configFor('client'), scripted);
    live.push(runner);
    runner.start();
    expect(() => runner.sim.world.pause()).toThrow(/does not support pause/);
    expect(runner.sim.world.paused).toBe(false);
    scripted.emitTick(0, { tick: 0, commands: {} });
    scripted.emitTick(1, { tick: 1, commands: {} });
    expect(runner.tick).toBe(1);
    expect(tinyCommandsProto).toBeNull();
  });

  it('keeps the world paused when restore runs during a transport pause', () => {
    const handle = drive();
    handle.runner.start();
    stepTo(handle, 2);
    handle.transport.requestPause();
    expect(handle.runner.sim.world.paused).toBe(true);
    handle.runner.restore(handle.runner.snapshot());
    expect(handle.runner.sim.world.paused).toBe(true);
    const tick = handle.runner.tick;
    handle.transport.step(1);
    expect(handle.runner.tick).toBe(tick);
    handle.transport.requestResume();
    expect(handle.runner.sim.world.paused).toBe(false);
  });

  it('resets the match RNG to the config seed before restore bootstrap', () => {
    setTinyCreateDraw(true);
    tinyCreateStates.length = 0;
    const handle = drive('client', 11);
    const fresh = tinyCreateStates[0];
    expect(fresh).toBeTypeOf('string');
    handle.runner.start();
    stepTo(handle, 4);
    const digest = handle.runner.digest();
    const advanced = (handle.runner.sim.random as DeterministicRandom)
      .getState()
      .join(',');
    expect(advanced).not.toBe(fresh);
    handle.runner.restore(handle.runner.snapshot());
    expect(tinyCreateStates[1]).toBe(fresh);
    expect(handle.runner.digest()).toBe(digest);
  });

  it('rejects a replay export when history was not recorded here', () => {
    const first = drive();
    first.runner.start();
    stepTo(first, 2);
    const snapshot = first.runner.snapshot();
    expect(first.runner.toReplay().lastTick).toBe(2);
    first.runner.restore(snapshot);
    expect(first.runner.toReplay().lastTick).toBe(2);

    const second = drive();
    second.runner.restore(snapshot);
    expect(second.runner.log.isComplete).toBe(false);
    expect(() => second.runner.toReplay()).toThrow(/command log is incomplete/);

    first.runner.log.truncateThrough(first.runner.tick);
    expect(() => first.runner.toReplay()).toThrow(/command log is incomplete/);
  });

  it('raises the local seq past commands delivered during catch-up', async () => {
    const first = drive();
    first.runner.start();
    first.runner.submit({ type: 'spawn', x: 1n });
    stepTo(first, 0);
    const snapshot = first.runner.snapshot();
    first.runner.submit({ type: 'move', dx: 2n });
    first.runner.submit({ type: 'move', dx: 3n });
    stepTo(first, 3);
    const tail = first.runner.log.entriesAfter(0);

    const second = drive();
    second.runner.restore(snapshot);
    second.runner.start();
    await second.runner.fastForward(tail, {
      budgetMs: 1000,
      throughTick: 3,
    });
    second.runner.submit({ type: 'move', dx: 9n });
    stepTo(second, 3 + DELAY);
    const human = second.runner.log
      .entriesAfter(-1)
      .filter((entry) => entry.playerId === 'local:0')
      .map((entry) => entry.data.q);
    expect(human).toEqual([0, 1, 2, 3]);
  });

  it('publishes outcome and digest after the tick and bot checkpoint', () => {
    const transport = LocalTransport.manual();
    const runner = new MatchRunner(
      TinyGame,
      { ...configFor('client', 1), arenaSize: 1 },
      transport,
      { hashEveryTicks: 1 }
    );
    live.push(runner);
    const seen: string[] = [];
    runner.onDigest((tick) => {
      seen.push(`digest:${String(tick)}:${String(runner.tick)}`);
      if (tick !== 0) return;
      const decoded = decodeSnapshot(runner.snapshot());
      const bytes = decoded.inputCheckpoint;
      if (bytes === null) throw new Error('missing input checkpoint');
      const checkpoint = decodeInputCheckpoint(bytes);
      const hosted = checkpoint.pending.some((batch) =>
        batch.entries.some((entry) => entry.playerId === botPlayerId(1))
      );
      expect(hosted).toBe(true);
    });
    runner.onOutcome(() => {
      seen.push(`outcome:${String(runner.tick)}`);
    });
    runner.submit({ type: 'spawn', x: 1n });
    runner.start();
    stepTo({ runner, transport }, 4);
    expect(seen[0]).toBe('digest:0:0');
    expect(seen).toContain('outcome:1');
    expect(seen).toContain('digest:1:1');
  });

  it('drops a late-delivered command from every pending tick', () => {
    const scripted = new ScriptedTransport();
    const runner = new MatchRunner(TinyGame, configFor('client', 9), scripted, {
      localSlots: [0],
    });
    live.push(runner);
    const submitted: { type: string; data?: unknown }[] = [];
    scripted.onSubmit = (_tick, _slot, commands) => {
      submitted.push(...commands);
    };
    runner.start();
    runner.submit({ type: 'spawn', x: 4n });
    const echoed = submitted[0];
    if (echoed === undefined) throw new Error('expected a submit');
    scripted.emitTick(0, { tick: 0, commands: {} });
    scripted.emitTick(1, { tick: 1, commands: {} });
    scripted.emitTick(2, {
      tick: 2,
      commands: { 'local:0': [echoed] },
    });
    expect(runner.sim.unitBySlot(0)?.x).toBe(4n);
    const decoded = decodeSnapshot(runner.snapshot());
    const bytes = decoded.inputCheckpoint;
    if (bytes === null) throw new Error('missing input checkpoint');
    const checkpoint = decodeInputCheckpoint(bytes);
    const still = checkpoint.pending.flatMap((batch) =>
      batch.entries.filter(
        (entry) => entry.playerId === 'local:0' && entry.data.q === 0
      )
    );
    expect(still).toEqual([]);
  });

  it('accepts a fractional payload without failing the tick', () => {
    const scripted = new ScriptedTransport();
    const runner = new MatchRunner(TinyGame, configFor('client', 2), scripted);
    live.push(runner);
    runner.start();
    scripted.emitTick(0, {
      tick: 0,
      commands: {
        'local:0': [
          {
            type: 'move',
            data: { q: 0, p: { speed: 0.5, type: 'move', dx: '1' } },
          },
        ],
      },
    });
    expect(runner.status).toBe('running');
    const payload = runner.log
      .entriesAfter(-1)
      .find((entry) => entry.playerId === 'local:0')?.data.p;
    expect(payload).toMatchObject({ speed: 0.5 });
    expect(Object.keys(payload ?? {})).toEqual(['dx', 'speed', 'type']);
  });

  it('refuses start on a replay runner', () => {
    const handle = drive();
    handle.runner.start();
    stepTo(handle, 1);
    const replay = handle.runner.toReplay();
    const replayed = MatchRunner.fromReplay(TinyGame, replay);
    live.push(replayed);
    expect(() => replayed.start()).toThrow(/fastForward\(replay\.log/);
  });
});
