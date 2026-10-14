import type { GameCommand } from './commands.js';
import type { GameDefinition, SimWorld } from './GameDefinition.js';
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

/**
 * Identity with validation and type inference. Returns `def` unchanged;
 * throws a descriptive error when a required field is missing or invalid.
 */
export function defineGame<
  Cfg extends MatchConfigBase,
  Cmd extends GameCommand,
  Sim extends SimWorld<Cmd>,
>(def: GameDefinition<Cfg, Cmd, Sim>): GameDefinition<Cfg, Cmd, Sim> {
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
  requireFunction(def, 'createWorld', `${label}: createWorld`);
  requireFunction(def, 'outcome', `${label}: outcome`);

  const commands: unknown = def.commands;
  if (typeof commands !== 'object' || commands === null) {
    fail(`${label}: commands must be a CommandSchema object`);
  }
  if (!Array.isArray(def.commands.types)) {
    fail(`${label}: commands.types must be an array of command type names`);
  }
  requireFunction(def.commands, 'decode', `${label}: commands.decode`);

  const state: unknown = def.state;
  if (typeof state !== 'object' || state === null) {
    fail(`${label}: state (GameStateSpec) is required`);
  }
  if (!isPositiveInteger(def.state.formatVersion)) {
    fail(`${label}: state.formatVersion must be a positive integer`);
  }
  requireFunction(def.state, 'bind', `${label}: state.bind`);

  if (def.bots !== undefined) {
    for (const name of Object.keys(def.bots).sort()) {
      requireFunction(def.bots, name, `${label}: bots.${name}`);
    }
  }
  return def;
}
