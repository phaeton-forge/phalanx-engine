---
name: phalanx-runtime
description: Describe a Phalanx game as one GameDefinition and run it with MatchRunner from @phalanx-engine/runtime (engine 0.3). Use when defining games with defineGame, implementing the GameState save/restore contract, writing BotPolicy bots, choosing simMode 'client' vs 'server', snapshots, replays, reconnect, or Transport/LocalTransport. Status - skeleton, implementation in progress.
metadata:
  author: phaeton2040-AI
  version: '0.1'
---

# Phalanx Runtime Skill

> **Status: skeleton, implementation in progress.** The contracts are final;
> most members throw `NotImplementedError` with
> `not implemented: <member> (Task NN)`. Check
> `docs/design/runtime-api.md` § Task map before relying on a member.

## When to Use This Skill

- Defining a game for engine 0.3 (`defineGame`, `GameDefinition`).
- Implementing `GameState` (snapshots, reconnect, server simulation).
- Writing bots as command producers (`BotPolicy`).
- Choosing `simMode: 'client' | 'server'` and slots (`SlotConfig`).

## Modes

- `client`: devices simulate; local bots (`runsOn: 'local'`); local
  snapshot every 300 ticks.
- `server`: the server is a lockstep peer; server bots
  (`runsOn: 'server'`); the server arbitrates digests and serves fresh
  snapshots. Only commands cross the wire.

## Rules

1. `createWorld(config, ctx)` builds `new GameWorld({ tickFrameProvider:
   ctx.tickFrameProvider, random: ctx.random, ... })` and calls
   `world.start()`. Never call `processAllTicks`.
2. `ctx.purpose === 'restore'`: build static content only;
   `GameState.restore` recreates dynamic entities.
3. Commands: `decode` is structural (no sim); `validate` is pure and reads
   the sim; `applyCommand` mutates. Payloads are JSON-safe; send FP raw
   values as decimal strings.
4. `GameState.save` uses only `StateWriter` primitives; no floats, no
   `JSON.stringify`. Use `list` for containers whose order the simulation
   observes and `sortedBy` for id-keyed containers.
5. `restore(save(x))` must re-save to identical bytes, and a restored world
   must produce the same digest as the original every tick.
6. Bot state is NOT `GameState`. Use `BotPolicy.save/restore`.
7. A bot's `decide(sim, tick)` must not mutate `sim`; its commands run at
   `tick + inputDelayTicks`.
8. Match configs are JSON-safe with integer numbers only.

## Minimal game

```ts
import { defineGame, rejectCommand } from '@phalanx-engine/runtime';

export const TinyGame = defineGame({
  id: 'tiny',
  simVersion: 'tiny-1',
  tickRate: 10,
  createWorld: (config: TinyConfig, ctx) => new TinySim(config, ctx),
  commands: {
    types: ['stop'],
    decode: (raw) =>
      isStop(raw) ? { type: 'stop' as const } : rejectCommand('unknown'),
  },
  state: { formatVersion: 1, bind: (sim) => new TinyState(sim) },
  outcome: () => null,
});

class TinyState implements GameState {
  constructor(private readonly sim: TinySim) {}
  save(w: StateWriter): void {
    w.section('units', 1, (s) =>
      s.list(this.sim.units, (u, iw) => {
        iw.u32(u.id);
        iw.i64(u.x);
      })
    );
  }
  restore(r: StateReader): void {
    const units = r.section('units', (s) =>
      s.list((ir) => ({ id: ir.u32(), x: ir.i64() }))
    );
    this.sim.units.splice(0, this.sim.units.length, ...units);
  }
}
```

## References

- `docs/design/runtime-api.md`: all contracts, review findings, task map.
- `docs/design/server-sim.md`, `docs/design/reconnect.md`.
- `phalanx-runtime/tests/fixtures/tinyGame.ts`: a type-checked example.
