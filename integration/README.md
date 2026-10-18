# @phalanx-engine/integration

Stage A integration suite for Phalanx. It is private, it is not
published, and it has no `build` or `test` script, so root
`pnpm build` / `pnpm test` (CI) do not run it.

The suite sees the engine only through `SimDriver` (`src/driver`) and
`GameFacade` (`src/facade/GameFacade.ts`). The default driver is
`adapters/v65.ts` (`createV65Driver`) on `@phalanx-engine/game`.
`facade/v65.ts` binds `defineGame`; the sim glue lives in
`facade/skirmishWorld.ts`. Rules and bots are pure functions in
`game/skirmish/`. `runConformance` is the acceptance test for a future
L2 or L3 adapter.

`adapters/current.ts` is gone. `main` has no older API to port from:
that adapter was already built on the 6.5b surface, only without
`defineComponent`, `defineCommands`, and `setController`. A second
adapter on the same API would double the maintenance and the suite
mutants.

Live peers are `MatchRunner` on `LocalTransport.stepped()`, not
`runLocalMatch`. `runLocalMatch` starts one clocked runner. This suite
builds several peers, steps them by hand, and pushes envelopes through
`FaultyTransport` before `deliver`. Replay peers are `ReplayPlayer`.

Pooled archetypes (`soldier`, `archer`, `totem`) stay. A physics body,
a transform, and the ability shell are attached in the factory, and
`world.spawn` cannot pick an archetype. Acquire uses `pools.spawn`.
The tick path reads units with `world.each` and removes them with
`world.despawn`. A restored live entity is a new object that skipped
the prewarm pass, so the return-to-pool hook would record its death
state on the first despawn. `onDespawn` writes the factory image
(health, power, abilities, tags) before that hook copies the shell, and
a later respawn matches a peer that never restored. `SkirmishUnit`
carries a trailing `eid` field so `world.each` can yield an id.

## Run

From the repo root, after `pnpm install` and `pnpm build`:

```bash
pnpm --filter @phalanx-engine/integration run it -- --profile quick
pnpm --filter @phalanx-engine/integration run it:unit
pnpm --filter @phalanx-engine/integration run typecheck
```

`--profile quick` is the default. It runs every stage A suite, perf at
150 entities, a short two-process determinism check, and 50 fuzz
timelines on each of 2 seeds. `--profile full` adds perf at 500
entities, a longer determinism check, and 500 timelines on each of 4
seeds plus every file in `scenarios/regressions/`.

Exit code is non-zero only for a ❌ that is not tagged `known-failure`.
A known failure that starts passing is ⚠️ `known failure now passes —
remove tag`.

## Profiles, tags, and filters

```bash
pnpm --filter @phalanx-engine/integration run it -- \
  --profile quick \
  --tag disconnect,save-restore \
  --scenario round-trip-sweep \
  --seed 21 \
  --fuzz 50 \
  --out integration/out \
  --pr 66 \
  --base <sha>
```

`--tag` and `--scenario` limit what runs. `--load path.json` runs one
scenario file. `--update-baseline` rewrites `baselines/perf.json`.

## Read the report

Each run writes `<out>/report.md` and `<out>/report.json` (default
`integration/out/`, gitignored). The header has the PR, head, base,
Node, pnpm, OS, profile, seed and duration. The table is scenario,
suite, tags, status, ticks, time and note. A failure section has the
first diverging tick, a field diff, the seed, the minimized timeline
and a copy-paste repro command. Perf rows list metric, baseline,
current and delta. Warn above 10%, fail above 25%. A heap sample at or
below zero is reported and not gated: GC decides the sign on a short run.
The baseline records host, CPU and Node. A different machine warns
instead of failing. Digests hash a canonical state dump (entities, GAS,
RNG, bot memory). Contact totals stay on the dump for assertions and
are left out of the hash, because they are not in the snapshot.

## Add a scenario

Add a `scenario(...)` value in `src/suites/catalog.ts`. The object is
JSON, so a fuzzer can promote it unchanged. Give it a suite, tags, a
seed, a tick count, slots (`human`, `human:1`, `bot:aggressive`,
`bot:defensive:0`) and peers. Timeline helpers live in
`src/dsl/scenario.ts`. `expect.converge` checks every peer against a
fresh replay of the authoritative log. `expect.failsWith` is a
substring of an error that must be thrown. `requires` skips the
scenario when the driver lacks that capability. `knownFailure` records
an engine bug without failing the run.

A controller handoff is `replaceWithBot(peer, policy, opts)` and
`returnFromBot(peer, opts)` (`slot`, `fromTick`, `delay`). The
interpreter calls `setController` on every in-window peer. `fromTick`
defaults to the authority tick plus `inputDelayTicks`. A rejected
request is a report note, and it fails the scenario when
`expect.converge` is set unless `expect.rejection` names that reason.
`expect.handoffRestore` (`before`, `at`, `after`) snapshots at
`fromTick − 1`, `fromTick`, or `fromTick + 1`, restores into a new
runner, and checks each later digest against the continuous run.
`before` is taken after `setController` has queued the handoff. The
restored peer steps across `fromTick` from that checkpoint and does
not replay the system command from the log.
`expect.botReinit` checks that the next handoff starts a fresh bot
from `seed + slot`. `expect.systemSeq` checks that the next system
command keeps a unique `q` and that a second save is byte-identical.
`expect.replay` compares `ReplayPlayer` digests with bot notes
stripped, because bot memory is outside the snapshot.

`restart-server` stays a skip. An in-process restart would not test
the relay. The skip reason is `stage B (L2): needs relay/SimHost
process (tasks 8, 11)`: SimHost (task 11) and a relay log that resumes
from tick N (task 8) are not on `main`.

A fault `delay`, `dup` or `reorder` submits the envelope to that peer's
transport when it is due. A `drop` is not resent; at the end of the
range the peer catches up from the authoritative log.
`fault-gate-observable` goes red when the gate delivers everything
immediately. `oracle-inject` must diverge. `expect.liveReference`
compares a restored match to a second live run that never restored.

## Promote a fuzz case

```bash
pnpm --filter @phalanx-engine/integration run it -- \
  --fuzz 50 --seed 1 --promote my-case
```

A failing timeline is shrunk and, with `--promote`, written to
`scenarios/regressions/<name>.json`. The next run picks the file up.
The report's repro line replays a saved timeline:

```bash
pnpm --filter @phalanx-engine/integration run it -- --load integration/out/repros/<name>.json
```

`injectDesync` (off unless a scenario asks for it) bumps one field on
one peer. `oracle-inject` is a catalog scenario that must diverge.
`inject-shrink` starts from 18 events and must shrink to at most five
while keeping the inject. The fuzzer can emit the same inject. The unit
test
`pnpm --filter @phalanx-engine/integration run it:unit -- tests/injectShrink.test.ts`
checks that shrink.

## Port the adapter

1. Implement `SimDriver` in `src/adapters/<api>.ts`.
2. Implement `GameFacade` in `src/facade/<api>.ts`. The skirmish rules
   in `src/game/skirmish/` must not import `@phalanx-engine/*`.
3. Point `src/run.ts` at the new driver.
4. `runConformance` and `pnpm run it:unit` must pass.

`src/facade/` and `src/adapters/` import only `@phalanx-engine/game` and
its subpaths `/math`, `/physics`, `/abilities` and `/advanced`.
`src/suites/packageSmoke.ts` may import the individual packages.
`pnpm run lint` and `tests/imports.test.ts` enforce that.

L2 (child processes, chaos proxy, `restartServer`) and L3 (browser
peers) are design-only. See `docs/stage-b.md`.
