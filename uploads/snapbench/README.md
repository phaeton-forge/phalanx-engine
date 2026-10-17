Snapshot save-cost bench (Phalanx main @ 21f19e8). Read-only clone in ./repo.
./run.sh main bench (SIZES=150,500,1000 ITERS=300 WARM=60 PRE_TICKS=200 OUT=results.json)
cd repo/integration && node --expose-gc --max-semi-space-size=256 --import tsx bench/alloc.ts # allocations per phase
cd repo/integration && node --import tsx bench/profile.ts # CPU profile of runner.snapshot() @1000 -> snap.cpuprofile
cd alt && node verify.mjs # BigInt XXH64 vs wasm XXH64 (byte-identical digest) timing
Sources live in repo/integration/bench (needs workspace resolution); copy in bench-src/.
Results: run1.txt, run2.txt (final), results.json.
