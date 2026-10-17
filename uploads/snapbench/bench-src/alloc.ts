import {
  LocalTransport,
  MatchRunner,
  BinaryStateWriter,
  digestBytes,
} from '@phalanx-engine/runtime';
import { createSkirmishGame } from '../src/facade/current.js';
const gc = (globalThis as any).gc as () => void;
for (const n of [150, 500, 1000]) {
  const session: any = {
    currentPeer: 'a',
    spawnOnRestore: false,
    suppressThrow: false,
    throwBot: false,
    poolProbe: false,
    dirtyAfterRestore: false,
    breakBotRestore: false,
    injectTick: -1,
    bots: {},
  };
  const game = createSkirmishGame(session, { armySize: n, slotCount: 2 });
  const config: any = {
    matchId: 'b',
    gameId: 'skirmish',
    simVersion: 'skirmish-1',
    seed: 1234,
    side: 'client',
    inputDelayTicks: 1,
    tickLimit: 1e6,
    armySize: n,
    slots: [
      { slot: 0, team: 0, kind: 'human', playerId: 'local:0' },
      {
        slot: 1,
        team: 1,
        kind: 'bot',
        policy: 'aggressive',
        level: 1,
        runsOn: 'local',
      },
    ],
  };
  const t = LocalTransport.stepped();
  const r: any = new MatchRunner(game, config, t, { localSlots: [0] });
  r.start();
  for (let i = 0; i < 200; i++) {
    if (i % 3 === 0) r.submit({ type: 'cast', ability: 1, target: 1 }, 0);
    t.step(1);
  }
  for (let i = 0; i < 20; i++) r.snapshot();
  const med = (fn: () => void) => {
    const xs: number[] = [];
    for (let i = 0; i < 15; i++) {
      gc();
      const h0 = process.memoryUsage().heapUsed;
      fn();
      xs.push(process.memoryUsage().heapUsed - h0);
    }
    xs.sort((a, b) => a - b);
    return (xs[7]! / 1024).toFixed(0) + ' KB';
  };
  let body!: Uint8Array;
  const cap = med(() =>
    r.scope.run(() => {
      const w = new BinaryStateWriter();
      r.requireGameState().save(w);
      body = w.finish();
    })
  );
  const dig = med(() => {
    digestBytes(body);
  });
  const snap = med(() => {
    r.snapshot();
  });
  console.log(
    `N=${n}: capture ${cap}, digestBytes ${dig}, runner.snapshot ${snap}, body ${body.byteLength} B`
  );
}
