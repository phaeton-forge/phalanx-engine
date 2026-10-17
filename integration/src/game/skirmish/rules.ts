import type { GameFacade } from '../../facade/GameFacade.js';
import {
  ABILITY_BANNER,
  ABILITY_STRIKE,
  ARCHER_RANGE,
  AURA_RANGE,
  EFFECT_BANNER,
  EFFECT_DAMAGE,
  KIND_ARCHER,
  KIND_SOLDIER,
  KIND_TOTEM,
  MAX_UNITS_PER_SLOT,
  TAG_BANNER,
  TAG_COOLDOWN,
  TOUCH_RANGE,
  type SkirmishCommand,
} from './types.js';

/**
 * Presentation-free skirmish tick. Aura runs before the ability systems
 * so a banner effect lands in the same tick. Death and respawn run after
 * those systems so damage applied this tick is visible.
 */
export function tickAura(api: GameFacade): void {
  api.eachUnit((totem) => {
    if (api.kindOf(totem) !== KIND_TOTEM) return;
    const team = api.teamOf(totem);
    api.eachUnit((other) => {
      if (other === totem || api.teamOf(other) !== team) return;
      if (!api.near(totem, other, AURA_RANGE)) return;
      if (api.hasTag(other, TAG_BANNER)) return;
      api.applyEffect(other, EFFECT_BANNER, totem);
    });
  });
}

export function tickLifecycle(api: GameFacade, tick: number): void {
  const roll = api.drawRng();
  let count = 0;
  api.eachUnit(() => {
    count += 1;
  });
  const focus = count === 0 ? -1 : roll % count;
  let index = 0;
  api.eachUnit((id) => {
    api.drift(id, roll, index === focus);
    index += 1;
    if (api.hp(id) <= 0n) api.kill(id, true);
  });
  api.flushRespawns(tick);
}

export interface CommandView {
  unitOf(slot: number): number | null;
  unitsOf(slot: number): number;
  kindOf(id: number): number;
  teamOf(id: number): number;
  slotOf(id: number): number;
  alive(id: number): boolean;
  hasTag(id: number, tag: string): boolean;
  bodiesTouching(a: number, b: number): boolean;
  near(a: number, b: number, rangeRaw: bigint): boolean;
}

/** Pure. `null` accepts the command. */
export function rejectReason(
  view: CommandView,
  command: SkirmishCommand,
  slot: number
): string | null {
  const self = view.unitOf(slot);
  if (command.type === 'spawn') {
    if (command.kind < KIND_SOLDIER || command.kind > KIND_TOTEM) {
      return 'bad kind';
    }
    if (view.unitsOf(slot) >= MAX_UNITS_PER_SLOT) return 'slot full';
    return null;
  }
  if (command.type === 'recall') {
    return self === null ? 'no unit' : null;
  }
  if (self === null) return 'no unit';
  if (command.type === 'move') {
    return command.dir >= 0 && command.dir <= 3 ? null : 'bad dir';
  }
  if (!view.alive(command.target)) return 'no target';
  if (view.slotOf(command.target) === slot) return 'own unit';
  if (view.teamOf(command.target) === view.teamOf(self)) return 'ally';
  if (command.type === 'attack') {
    const range =
      view.kindOf(self) === KIND_ARCHER ? ARCHER_RANGE : TOUCH_RANGE;
    const inRange =
      view.kindOf(self) === KIND_ARCHER
        ? view.near(self, command.target, range)
        : view.bodiesTouching(self, command.target) ||
          view.near(self, command.target, range);
    return inRange ? null : 'out of range';
  }
  if (command.ability !== 0 && command.ability !== 1) return 'bad ability';
  if (command.ability === 0 && view.hasTag(self, TAG_COOLDOWN)) {
    return 'cooldown';
  }
  return null;
}

export interface CommandSink {
  move(id: number, dir: number): void;
  damage(id: number, source: number): void;
  cast(id: number, ability: string, target: number): void;
  spawn(kind: number, slot: number): number;
  recall(id: number): void;
}

export function applySkirmish(
  sink: CommandSink,
  command: SkirmishCommand,
  slot: number,
  self: number | null
): void {
  if (command.type === 'spawn') {
    sink.spawn(command.kind, slot);
    return;
  }
  if (self === null) return;
  if (command.type === 'move') {
    sink.move(self, command.dir);
    return;
  }
  if (command.type === 'recall') {
    sink.recall(self);
    return;
  }
  if (command.type === 'attack') {
    sink.damage(command.target, self);
    return;
  }
  const ability = command.ability === 0 ? ABILITY_STRIKE : ABILITY_BANNER;
  const target = command.ability === 0 ? command.target : self;
  sink.cast(self, ability, target);
}

export { EFFECT_DAMAGE, KIND_SOLDIER };
