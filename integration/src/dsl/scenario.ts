import type { GameOptions } from '../driver/SimDriver.js';

export interface Expectation {
  readonly converge?: boolean;
  readonly failsWith?: string;
}

export type TimelineEvent =
  | { readonly at: number; readonly op: 'disconnect'; readonly peer: string }
  | {
      readonly at: number;
      readonly op: 'reconnect';
      readonly peer: string;
      readonly via: 'snapshot' | 'log';
    }
  | { readonly at: number; readonly op: 'crash'; readonly peer: string }
  | {
      readonly op: 'faults';
      readonly from: number;
      readonly to: number;
      readonly peer: string;
      readonly delay: readonly [number, number];
      readonly dup: number;
      readonly reorder: number;
      readonly drop: number;
    }
  | {
      readonly at: number;
      readonly op: 'replaceWithBot';
      readonly peer: string;
      readonly policy: string;
    }
  | { readonly at: number; readonly op: 'returnFromBot'; readonly peer: string }
  | { readonly at: number; readonly op: 'restartServer' }
  | { readonly at: number; readonly op: 'pause' }
  | { readonly at: number; readonly op: 'resume' }
  | { readonly at: number; readonly op: 'malformed'; readonly peer: string }
  | { readonly at: number; readonly op: 'throwBot' }
  | { readonly at: number; readonly op: 'throwSystem' }
  | {
      readonly at: number;
      readonly op: 'inject';
      readonly peer: string;
      readonly when?: 'restore' | 'tick';
    }
  | { readonly at: number; readonly op: 'roundTrip'; readonly peer: string }
  | { readonly at: number; readonly op: 'schemaChange'; readonly peer: string }
  | { readonly at: number; readonly op: 'restoreSelf'; readonly peer: string };

export interface Scenario {
  readonly name: string;
  readonly suite: string;
  readonly tags: readonly string[];
  readonly seed: number;
  readonly ticks: number;
  readonly slots: readonly string[];
  readonly peers: readonly string[];
  readonly timeline: readonly TimelineEvent[];
  readonly inputs: 'scripted:basic' | 'bots';
  readonly expect: Expectation;
  readonly knownFailure?: string;
  readonly requires?: readonly (
    'setController' | 'restartServer' | 'replayPlayer'
  )[];
  readonly options?: GameOptions;
}

export function scenario(
  name: string,
  fields: Omit<Scenario, 'name'>
): Scenario {
  return { name, ...fields };
}

export function at<T extends { readonly op: string }>(
  tick: number,
  body: T
): T & { readonly at: number } {
  return { ...body, at: tick };
}

export function disconnect(peer: string): {
  readonly op: 'disconnect';
  readonly peer: string;
} {
  return { op: 'disconnect', peer };
}

export function reconnect(
  peer: string,
  via: 'snapshot' | 'log'
): {
  readonly op: 'reconnect';
  readonly peer: string;
  readonly via: 'snapshot' | 'log';
} {
  return { op: 'reconnect', peer, via };
}

export function crashPeer(peer: string): {
  readonly op: 'crash';
  readonly peer: string;
} {
  return { op: 'crash', peer };
}

export function faults(
  peer: string,
  spec: {
    readonly delay: readonly [number, number];
    readonly dup: number;
    readonly reorder: number;
    readonly drop: number;
  }
): {
  readonly op: 'faults';
  readonly peer: string;
  readonly delay: readonly [number, number];
  readonly dup: number;
  readonly reorder: number;
  readonly drop: number;
} {
  return { op: 'faults', peer, ...spec };
}

export function range<T extends { readonly op: string }>(
  from: number,
  to: number,
  body: T
): T & { readonly from: number; readonly to: number } {
  return { ...body, from, to };
}

export function replaceWithBot(
  peer: string,
  policy: string
): {
  readonly op: 'replaceWithBot';
  readonly peer: string;
  readonly policy: string;
} {
  return { op: 'replaceWithBot', peer, policy };
}

export function returnFromBot(peer: string): {
  readonly op: 'returnFromBot';
  readonly peer: string;
} {
  return { op: 'returnFromBot', peer };
}

export function restartServer(): { readonly op: 'restartServer' } {
  return { op: 'restartServer' };
}

export function parseScenario(value: unknown): Scenario {
  const record = asRecord(value, 'scenario');
  const inputs = record['inputs'];
  if (inputs !== 'scripted:basic' && inputs !== 'bots') {
    throw new Error('scenario: inputs must be scripted:basic or bots');
  }
  const expect = asRecord(record['expect'], 'scenario.expect');
  const failsWith = expect['failsWith'];
  const converge = expect['converge'];
  return {
    name: asString(record['name'], 'name'),
    suite: asString(record['suite'], 'suite'),
    tags: asStringList(record['tags'], 'tags'),
    seed: asInt(record['seed'], 'seed'),
    ticks: asInt(record['ticks'], 'ticks'),
    slots: asStringList(record['slots'], 'slots'),
    peers: asStringList(record['peers'], 'peers'),
    timeline: asArray(record['timeline'], 'timeline').map(parseEvent),
    inputs,
    expect: {
      ...(converge === undefined
        ? {}
        : { converge: asBoolean(converge, 'converge') }),
      ...(failsWith === undefined
        ? {}
        : { failsWith: asString(failsWith, 'failsWith') }),
    },
    ...(record['knownFailure'] === undefined
      ? {}
      : { knownFailure: asString(record['knownFailure'], 'knownFailure') }),
    ...(record['requires'] === undefined
      ? {}
      : {
          requires: asStringList(record['requires'], 'requires').map(asRequire),
        }),
    ...(record['options'] === undefined
      ? {}
      : { options: parseOptions(record['options']) }),
  };
}

function parseEvent(value: unknown): TimelineEvent {
  const record = asRecord(value, 'event');
  const op = asString(record['op'], 'op');
  if (op === 'disconnect' || op === 'crash') {
    return {
      at: asInt(record['at'], 'at'),
      op,
      peer: asString(record['peer'], 'peer'),
    };
  }
  if (op === 'reconnect') {
    const via = record['via'];
    if (via !== 'snapshot' && via !== 'log') {
      throw new Error('scenario: reconnect via must be snapshot or log');
    }
    return {
      at: asInt(record['at'], 'at'),
      op,
      peer: asString(record['peer'], 'peer'),
      via,
    };
  }
  if (op === 'faults') {
    const delay = asArray(record['delay'], 'delay');
    return {
      op,
      from: asInt(record['from'], 'from'),
      to: asInt(record['to'], 'to'),
      peer: asString(record['peer'], 'peer'),
      delay: [asInt(delay[0], 'delay[0]'), asInt(delay[1], 'delay[1]')],
      dup: asNumber(record['dup'], 'dup'),
      reorder: asNumber(record['reorder'], 'reorder'),
      drop: asNumber(record['drop'], 'drop'),
    };
  }
  if (op === 'replaceWithBot') {
    return {
      at: asInt(record['at'], 'at'),
      op,
      peer: asString(record['peer'], 'peer'),
      policy: asString(record['policy'], 'policy'),
    };
  }
  if (op === 'returnFromBot') {
    return {
      at: asInt(record['at'], 'at'),
      op,
      peer: asString(record['peer'], 'peer'),
    };
  }
  if (
    op === 'restartServer' ||
    op === 'pause' ||
    op === 'resume' ||
    op === 'throwBot' ||
    op === 'throwSystem'
  ) {
    return { at: asInt(record['at'], 'at'), op };
  }
  if (
    op === 'malformed' ||
    op === 'roundTrip' ||
    op === 'schemaChange' ||
    op === 'restoreSelf'
  ) {
    return {
      at: asInt(record['at'], 'at'),
      op,
      peer: asString(record['peer'], 'peer'),
    };
  }
  if (op === 'inject') {
    const when = record['when'];
    if (when !== undefined && when !== 'restore' && when !== 'tick') {
      throw new Error('scenario: inject when must be restore or tick');
    }
    return {
      at: asInt(record['at'], 'at'),
      op,
      peer: asString(record['peer'], 'peer'),
      ...(when === undefined ? {} : { when }),
    };
  }
  throw new Error(`scenario: unknown event ${op}`);
}

function parseOptions(value: unknown): GameOptions {
  const record = asRecord(value, 'options');
  const options: {
    armySize?: number;
    tickLimit?: number;
    spawnOnRestore?: boolean;
    throwOnTick?: number;
    throwBot?: boolean;
    poolProbe?: boolean;
    legacySpawnWithId?: boolean;
    injectDesync?: GameOptions['injectDesync'];
  } = {};
  if (record['armySize'] !== undefined)
    options.armySize = asInt(record['armySize'], 'armySize');
  if (record['tickLimit'] !== undefined) {
    options.tickLimit = asInt(record['tickLimit'], 'tickLimit');
  }
  if (record['spawnOnRestore'] !== undefined) {
    options.spawnOnRestore = asBoolean(
      record['spawnOnRestore'],
      'spawnOnRestore'
    );
  }
  if (record['throwOnTick'] !== undefined) {
    options.throwOnTick = asInt(record['throwOnTick'], 'throwOnTick');
  }
  if (record['throwBot'] !== undefined)
    options.throwBot = asBoolean(record['throwBot'], 'throwBot');
  if (record['poolProbe'] !== undefined) {
    options.poolProbe = asBoolean(record['poolProbe'], 'poolProbe');
  }
  if (record['legacySpawnWithId'] !== undefined) {
    options.legacySpawnWithId = asBoolean(
      record['legacySpawnWithId'],
      'legacySpawnWithId'
    );
  }
  if (record['injectDesync'] !== undefined) {
    const inject = asRecord(record['injectDesync'], 'injectDesync');
    const when = inject['when'];
    if (when !== undefined && when !== 'restore' && when !== 'tick') {
      throw new Error('scenario: injectDesync.when must be restore or tick');
    }
    options.injectDesync = {
      peer: asString(inject['peer'], 'peer'),
      afterTick: asInt(inject['afterTick'], 'afterTick'),
      ...(when === undefined ? {} : { when }),
    };
  }
  return options;
}

function asRequire(
  value: string
): 'setController' | 'restartServer' | 'replayPlayer' {
  if (
    value === 'setController' ||
    value === 'restartServer' ||
    value === 'replayPlayer'
  ) {
    return value;
  }
  throw new Error(`scenario: unknown requirement ${value}`);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`scenario: ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value))
    throw new Error(`scenario: ${label} must be an array`);
  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string')
    throw new Error(`scenario: ${label} must be a string`);
  return value;
}

function asStringList(value: unknown, label: string): readonly string[] {
  return asArray(value, label).map((item) => asString(item, label));
}

function asInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`scenario: ${label} must be an integer`);
  }
  return value;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`scenario: ${label} must be a number`);
  }
  return value;
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean')
    throw new Error(`scenario: ${label} must be a boolean`);
  return value;
}
