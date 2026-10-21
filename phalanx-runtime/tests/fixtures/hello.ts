import * as game from '@phalanx-engine/game';
const Unit = game.defineComponent('Unit', { x: 'i64' });
const commands = game.defineCommands({ move: { dx: 'i64' } });
const pace = [{ type: 'move' as const, dx: 1n }];
class Drift extends game.GameSystem {
  public processTick(): void {
    game.each(this.world, Unit, (unit) => (unit.x += 0n));
  }
}
const hello = game.defineGame({
  id: 'hello',
  simVersion: '1',
  tickRate: 10,
  components: [Unit],
  systems: [() => new Drift()],
  commands,
  onStart(ctx) {
    if (ctx.purpose === 'fresh') game.spawn(ctx.world, { Unit: { x: 0n } });
  },
  onCommand: {
    move(ctx, stamped) {
      game.each(ctx.world, Unit, (unit) => (unit.x += stamped.command.dx));
    },
  },
  bots: { walker: () => ({ decide: () => pace }) },
  checkOutcome: () => null,
});
export function playHello(): readonly [bigint, bigint] {
  const match = game.runLocalMatch(hello, {
    seed: 1,
    stepped: true,
    slots: [{ kind: 'human' }, { kind: 'bot', policy: 'walker' }],
  });
  const read = (): bigint => {
    let value = 0n;
    game.each(match.runner.sim.world, Unit, (unit) => (value = unit.x));
    return value;
  };
  match.runner.submit({ type: 'move', dx: 2n });
  match.step(4);
  const before = read();
  match.runner.restore(match.runner.snapshot());
  const after = read();
  return (match.runner.dispose(), [before, after]);
}
