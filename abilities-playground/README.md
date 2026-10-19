# abilities-playground

`SimulationContainer` builds the match RNG from `client.randomSeed` with
`new DeterministicRandom(seed)` (`@phalanx-engine/math`). A null seed throws
`SimulationContainer: client.randomSeed is null, await waitForGameStart() first`.
