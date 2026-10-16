import {
  defineCommands,
  defineComponent,
  defineGame,
  runLocalMatch,
} from '@phalanx-engine/engine';

const Unit = defineComponent('Unit', { x: 'i64' });
const commands = defineCommands({ move: { dx: 'i64' } });
const pace = [{ type: 'move' as const, dx: 1n }];
const game = defineGame({
  id: 'hello',
  simVersion: '1',
  tickRate: 10,
  components: [Unit],
  commands,
  onStart(ctx) {
    if (ctx.purpose === 'fresh') ctx.world.spawn({ Unit: { x: 0n } });
  },
  onCommand: {
    move(ctx, stamped) {
      ctx.world.each(Unit, (unit) => (unit.x += stamped.command.dx));
    },
  },
  bots: { walker: () => ({ decide: () => pace }) },
  checkOutcome: () => null,
});
export function playHello(): readonly [bigint, bigint] {
  const match = runLocalMatch(game, {
    seed: 1,
    stepped: true,
    slots: [{ kind: 'human' }, { kind: 'bot', policy: 'walker' }],
  });
  const read = (): bigint => {
    let value = 0n;
    match.runner.sim.world.each(Unit, (unit) => (value = unit.x));
    return value;
  };
  match.runner.submit({ type: 'move', dx: 2n });
  match.step(4);
  const before = read();
  match.runner.restore(match.runner.snapshot());
  const after = read();
  return (match.runner.dispose(), [before, after]);
}
