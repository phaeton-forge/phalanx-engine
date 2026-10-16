import type { BotPolicyFactory } from '../runner/BotPolicy.js';
import type { SaveSpec } from '../state/GameState.js';
import { createDefaultWorldState } from '../world/defaultState.js';
import type { GameCommand } from './commands.js';
import type { DefinedCommands } from './defineCommands.js';
import type { GameDefinition, OnCommand, SimWorld } from './GameDefinition.js';
import type { MatchConfigBase } from './MatchConfig.js';

function fail(message: string): never {
  throw new Error(`defineGame: ${message}`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function requireFunction(owner: object, key: string, name: string): void {
  if (typeof (owner as Record<string, unknown>)[key] !== 'function') {
    fail(`${name} must be a function`);
  }
}

type GameInput<
  Cfg extends MatchConfigBase,
  Cmd extends GameCommand,
  Sim extends SimWorld,
> = Omit<GameDefinition<Cfg, Cmd, Sim>, 'save' | 'onCommand' | 'bots'> & {
  readonly save?: SaveSpec<NoInfer<Sim>>;
  /**
   * `commands` is the inference site for `Cmd`. Callbacks use `NoInfer`
   * so a bot's returned command object cannot widen `Cmd` to `GameCommand`
   * (that would make a handler's payload `never`).
   */
  readonly onCommand: OnCommand<NoInfer<Cmd>, NoInfer<Sim>, NoInfer<Cfg>>;
  readonly bots?: Readonly<
    Record<string, BotPolicyFactory<NoInfer<Cfg>, NoInfer<Cmd>, NoInfer<Sim>>>
  >;
};

/**
 * Identity with validation and type inference. Returns `def` unchanged
 * when `save` is present. When `save` is omitted, returns a copy whose
 * save handler is the world modules.
 */
export function defineGame<
  Cfg extends MatchConfigBase,
  Cmd extends GameCommand,
  Sim extends SimWorld,
>(def: GameInput<Cfg, Cmd, Sim>): GameDefinition<Cfg, Cmd, Sim> {
  const raw: unknown = def;
  if (typeof raw !== 'object' || raw === null) {
    fail('definition must be an object');
  }
  if (!isNonEmptyString(def.id)) {
    fail('id must be a non-empty string');
  }
  const label = `game '${def.id}'`;
  if (!isNonEmptyString(def.simVersion)) {
    fail(`${label}: simVersion must be a non-empty string`);
  }
  if (!isPositiveInteger(def.tickRate)) {
    fail(
      `${label}: tickRate must be a positive integer, got ${String(def.tickRate)}`
    );
  }
  if (def.onStart !== undefined) {
    requireFunction(def, 'onStart', `${label}: onStart`);
  }
  requireFunction(def, 'checkOutcome', `${label}: checkOutcome`);
  requireCommands(def.commands, label);
  requireOnCommand(def.onCommand, def.commands, label);
  requireFactories(def.systems, `${label}: systems`);
  requireFactories(def.frameSystems, `${label}: frameSystems`);
  if (def.components !== undefined && !Array.isArray(def.components)) {
    fail(`${label}: components must be an array`);
  }

  if (def.bots !== undefined) {
    for (const name of Object.keys(def.bots).sort()) {
      requireFunction(def.bots, name, `${label}: bots.${name}`);
    }
  }

  if (def.save === undefined) {
    return { ...def, save: createDefaultWorldState<Sim>() };
  }
  if (!isPositiveInteger(def.save.formatVersion)) {
    fail(`${label}: save.formatVersion must be a positive integer`);
  }
  requireFunction(def.save, 'handler', `${label}: save.handler`);
  return def as GameDefinition<Cfg, Cmd, Sim>;
}

function requireCommands(commands: unknown, label: string): void {
  if (typeof commands !== 'object' || commands === null) {
    fail(`${label}: commands must be a defineCommands() result`);
  }
  const record = commands as DefinedCommands;
  if (!Array.isArray(record.types)) {
    fail(`${label}: commands.types must be an array of command type names`);
  }
  if (!Array.isArray(record.schema)) {
    fail(`${label}: commands.schema must be an array`);
  }
  requireFunction(record, 'decode', `${label}: commands.decode`);
  requireFunction(record, 'encode', `${label}: commands.encode`);
}

function requireOnCommand(
  onCommand: unknown,
  commands: DefinedCommands,
  label: string
): void {
  if (typeof onCommand === 'function') return;
  if (typeof onCommand !== 'object' || onCommand === null) {
    fail(`${label}: onCommand must be a function or a handler map`);
  }
  const record = onCommand as Record<string, unknown>;
  for (const type of commands.types) {
    if (typeof record[type] !== 'function') {
      fail(`${label}: onCommand.${type} must be a function`);
    }
  }
}

function requireFactories(
  factories: readonly (() => unknown)[] | undefined,
  label: string
): void {
  if (factories === undefined) return;
  if (!Array.isArray(factories)) fail(`${label} must be an array`);
  for (let index = 0; index < factories.length; index += 1) {
    if (typeof factories[index] !== 'function') {
      fail(`${label}[${String(index)}] must be a function`);
    }
  }
}
