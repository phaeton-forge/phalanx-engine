# @phalanx-engine/integration

Stage A integration suite for Phalanx. It is private, it is not
published, and it has no `build` or `test` script, so root
`pnpm build` / `pnpm test` (CI) do not run it.

The suite sees the engine only through `SimDriver` (`src/driver`) and
`GameFacade` (`src/facade/GameFacade.ts`). `adapters/current.ts` and
`facade/current.ts` are the port onto today's `main` API (`defineGame`,
`MatchRunner`, `LocalTransport`, `world.save` / `world.restore`).
When a later API lands, add `adapters/v65.ts` and `facade/v65.ts` and
switch the default. Scenarios, the DSL, the oracle, the fuzzer, the
report and the skirmish rules stay put. `runConformance` is the port's
acceptance test.

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

A fault `drop` does not resend on the wire. At the end of the range
the peer catches up from the authoritative log.

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
one peer. The unit test
`pnpm --filter @phalanx-engine/integration run it:unit -- tests/injectShrink.test.ts`
checks that the fuzzer finds that desync and shrinks it to at most
five timeline events.

## Port the adapter

1. Implement `SimDriver` in `src/adapters/<api>.ts`.
2. Implement `GameFacade` in `src/facade/<api>.ts`. The skirmish rules
   in `src/game/skirmish/` must not import `@phalanx-engine/*`.
3. Point `src/run.ts` at the new driver.
4. `runConformance` and `pnpm run it:unit` must pass.

Only `src/adapters/`, `src/facade/` and `src/suites/packageSmoke.ts`
may import `@phalanx-engine/*`. `pnpm run lint` in this package and
`tests/imports.test.ts` enforce that.

L2 (child processes, chaos proxy, `restartServer`) and L3 (browser
peers) are design-only. See `docs/stage-b.md`.
