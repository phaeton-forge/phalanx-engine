# Snapshot bench

Measures the synchronous tick capture for a periodic hash and for a
snapshot seal, plus off-tick XXH64 and `encodeSnapshot`, on the skirmish
world at 500 and 1000 entities.

```bash
pnpm --filter @phalanx-engine/runtime build
pnpm --filter @phalanx-engine/runtime run bench
```

The script is `node --expose-gc --import tsx bench/snapshot.bench.ts`.
It is not part of `build` or `test`. Warmup is 60 iterations and the
timed phase is 200. The world is advanced 200 ticks first, with a cast
every third tick. At 1000 entities it also prints a per-section split
of the world save: pools, SoA, abilities, and the remaining sections.

Acceptance numbers are for the Xeon 2.4 GHz box (Node 20.19). This
machine is whatever host runs the command; the printed `cpu` line is
the description to copy into the PR. A phone measurement is not part of
this bench. The reference phone is a Redmi 13C (Helio G85), about 5×
the box.

Hash capture reuses one `BinaryStateWriter`, which is what the tick
does. Snapshot capture adds the bot section and the input checkpoint.
`encodeSnapshot` and `digestBytes` are timed separately. `encodeSnapshot`
also hashes the body, so its time includes a digest.
