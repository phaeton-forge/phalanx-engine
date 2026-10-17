import { performance } from 'node:perf_hooks';
import { LocalTransport, MatchRunner } from '@phalanx-engine/runtime';
import { createSkirmishGame } from '../src/facade/current.js';
const n = 1000;
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
const r = new MatchRunner(game, config, t, { localSlots: [0] });
r.start();
for (let i = 0; i < 200; i++) {
  if (i % 3 === 0) r.submit({ type: 'cast', ability: 1, target: 1 } as any, 0);
  t.step(1);
}
import('node:inspector').then(async ({ Session }) => {
  const ss = new Session();
  ss.connect();
  const post = (m: string, p?: any) =>
    new Promise<any>((res, rej) =>
      ss.post(m, p, (e, v) => (e ? rej(e) : res(v)))
    );
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 50 });
  await post('Profiler.start');
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) r.snapshot();
  console.log('ms/snap', (performance.now() - t0) / 300);
  const { profile } = await post('Profiler.stop');
  (await import('node:fs')).writeFileSync(
    '/tmp/snapbench/snap.cpuprofile',
    JSON.stringify(profile)
  );
});
