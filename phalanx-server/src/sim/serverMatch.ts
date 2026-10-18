import {
  botPlayerId,
  DEFAULT_INPUT_DELAY_TICKS,
} from '@phalanx-engine/runtime';
import type { SlotConfig } from '@phalanx-engine/runtime';
import type { PhalanxConfig, QueuedPlayer } from '../types/index.js';
import type { RegisteredGame } from './loadGames.js';

export interface PreparedServerMatch {
  readonly game: RegisteredGame;
  readonly slots: readonly SlotConfig[];
  readonly teams: QueuedPlayer[][];
  readonly inputDelayTicks: number;
  readonly absencePolicy?: string;
  readonly extras: Readonly<Record<string, number>>;
  /** Human player ids still waiting for a socket, besides the creator. */
  readonly waitingHumanIds: readonly string[];
}

export type ParseMatchResult =
  { ok: true; prepared: PreparedServerMatch } | { ok: false; message: string };

const KNOWN_KEYS = new Set([
  'gameId',
  'simMode',
  'slots',
  'inputDelayTicks',
  'absencePolicy',
]);

/** Never copied from a client `matchConfig` into the runner config. */
export const ENGINE_MATCH_CONFIG_KEYS = new Set([
  'matchId',
  'gameId',
  'simVersion',
  'seed',
  'side',
  'slots',
  'inputDelayTicks',
  'simMode',
  'absencePolicy',
]);

function fail(message: string): ParseMatchResult {
  return { ok: false, message };
}

function isRecord(
  value: unknown
): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSlot(value: unknown, index: number): SlotConfig | string {
  if (!isRecord(value)) return `slots[${String(index)}] must be an object`;
  const slot = value['slot'];
  const team = value['team'];
  const kind = value['kind'];
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0) {
    return `slots[${String(index)}].slot must be a non-negative integer`;
  }
  if (typeof team !== 'number' || !Number.isInteger(team) || team < 0) {
    return `slots[${String(index)}].team must be a non-negative integer`;
  }
  if (kind === 'human') {
    const playerId = value['playerId'];
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return `slots[${String(index)}].playerId must be a non-empty string`;
    }
    return { slot, team, kind: 'human', playerId };
  }
  if (kind === 'bot') {
    const policy = value['policy'];
    if (typeof policy !== 'string' || policy.length === 0) {
      return `slots[${String(index)}].policy must be a non-empty string`;
    }
    const level = value['level'];
    const runsOn = value['runsOn'];
    const resolvedLevel = level === undefined ? 0 : level;
    if (
      typeof resolvedLevel !== 'number' ||
      !Number.isInteger(resolvedLevel) ||
      resolvedLevel < 0
    ) {
      return `slots[${String(index)}].level must be a non-negative integer`;
    }
    const resolvedRunsOn = runsOn === undefined ? 'server' : runsOn;
    if (resolvedRunsOn !== 'server' && resolvedRunsOn !== 'local') {
      return `slots[${String(index)}].runsOn must be 'server' or 'local'`;
    }
    if (resolvedRunsOn !== 'server') {
      return `slots[${String(index)}] must run on the server in simMode 'server'`;
    }
    return {
      slot,
      team,
      kind: 'bot',
      policy,
      level: resolvedLevel,
      runsOn: 'server',
    };
  }
  return `slots[${String(index)}].kind must be 'human' or 'bot'`;
}

function playerFor(
  slot: SlotConfig,
  host: QueuedPlayer,
  now: number,
  gameType: string
): QueuedPlayer | string {
  if (slot.kind === 'bot') {
    const playerId = botPlayerId(slot.slot);
    return {
      playerId,
      username: playerId,
      socketId: '',
      joinedAt: now,
      gameType,
      kind: 'bot',
    };
  }
  if (slot.playerId === host.playerId) {
    return { ...host, kind: 'human' };
  }
  return {
    playerId: slot.playerId,
    username: slot.playerId,
    socketId: '',
    joinedAt: now,
    gameType,
    kind: 'human',
  };
}

function buildTeams(
  slots: readonly SlotConfig[],
  bySlot: ReadonlyMap<number, QueuedPlayer>
): QueuedPlayer[][] | string {
  let maxTeam = 0;
  for (const slot of slots) {
    if (slot.team > maxTeam) maxTeam = slot.team;
  }
  const teams: QueuedPlayer[][] = [];
  for (let team = 0; team <= maxTeam; team += 1) teams.push([]);
  for (const slot of slots) {
    const player = bySlot.get(slot.slot);
    const team = teams[slot.team];
    if (player === undefined || team === undefined) {
      return 'slots must be ordered so teams.flat() index equals slot';
    }
    team.push(player);
  }
  const flat = teams.flat();
  if (flat.length !== slots.length) {
    return 'slots must be ordered so teams.flat() index equals slot';
  }
  for (let index = 0; index < slots.length; index += 1) {
    const player = flat[index];
    const slot = slots[index];
    if (player === undefined || slot === undefined) {
      return 'slots must be ordered so teams.flat() index equals slot';
    }
    const expected =
      slot.kind === 'bot' ? botPlayerId(slot.slot) : slot.playerId;
    if (player.playerId !== expected) {
      return 'slots must be ordered so teams.flat() index equals slot';
    }
  }
  return teams;
}

/**
 * Turn a `room-create` `matchConfig` into teams and a runner config.
 * Omitted config is not an error: the caller keeps today's two-human room.
 */
export function parseServerMatch(options: {
  raw: unknown;
  host: QueuedPlayer;
  gameType: string;
  catalog: readonly RegisteredGame[];
  config: PhalanxConfig;
}): ParseMatchResult {
  const { raw, host, gameType, catalog, config } = options;
  if (!isRecord(raw)) return fail('matchConfig must be an object');
  if (raw['simMode'] !== 'server') {
    return fail("matchConfig.simMode must be 'server'");
  }
  const gameId = raw['gameId'];
  if (typeof gameId !== 'string' || gameId.length === 0) {
    return fail('matchConfig.gameId must be a non-empty string');
  }
  const game = catalog.find((entry) => entry.id === gameId);
  if (game === undefined) {
    if (catalog.length === 0) {
      return fail('Server simulation is not configured');
    }
    return fail(`Game '${gameId}' is not registered`);
  }
  const slotsRaw = raw['slots'];
  if (!Array.isArray(slotsRaw) || slotsRaw.length === 0) {
    return fail('matchConfig.slots must be a non-empty array');
  }
  const slots: SlotConfig[] = [];
  for (let index = 0; index < slotsRaw.length; index += 1) {
    const parsed = parseSlot(slotsRaw[index], index);
    if (typeof parsed === 'string') return fail(parsed);
    slots.push(parsed);
  }
  slots.sort((left, right) => left.slot - right.slot);
  for (let index = 0; index < slots.length; index += 1) {
    if (slots[index]?.slot !== index) {
      return fail('slots must be contiguous and sorted from 0');
    }
  }
  const ids = new Set<string>();
  let hostSlot = false;
  for (const slot of slots) {
    const playerId =
      slot.kind === 'human' ? slot.playerId : botPlayerId(slot.slot);
    if (ids.has(playerId)) return fail(`duplicate player '${playerId}'`);
    ids.add(playerId);
    if (slot.kind === 'human' && slot.playerId === host.playerId) {
      hostSlot = true;
    }
  }
  if (!hostSlot) {
    return fail('the creating player must occupy a human slot');
  }
  const delayRaw = raw['inputDelayTicks'];
  const inputDelayTicks =
    delayRaw === undefined ? DEFAULT_INPUT_DELAY_TICKS : delayRaw;
  if (
    typeof inputDelayTicks !== 'number' ||
    !Number.isInteger(inputDelayTicks) ||
    inputDelayTicks < 1 ||
    inputDelayTicks > config.maxTickAhead
  ) {
    return fail(
      `inputDelayTicks must be an integer from 1 to maxTickAhead (${String(config.maxTickAhead)})`
    );
  }
  const absenceRaw = raw['absencePolicy'];
  let absencePolicy: string | undefined;
  if (absenceRaw !== undefined) {
    if (typeof absenceRaw !== 'string' || absenceRaw.length === 0) {
      return fail('absencePolicy must be a non-empty string');
    }
    absencePolicy = absenceRaw;
  }
  const allowed = new Set(game.configKeys);
  const extras: Record<string, number> = {};
  for (const key of Object.keys(raw).sort()) {
    if (KNOWN_KEYS.has(key)) continue;
    if (!allowed.has(key)) {
      return fail(`matchConfig.${key} is not allowed`);
    }
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return fail(`matchConfig.${key} must be an integer`);
    }
    extras[key] = value;
  }
  const now = Date.now();
  const bySlot = new Map<number, QueuedPlayer>();
  const waitingHumanIds: string[] = [];
  for (const slot of slots) {
    const player = playerFor(slot, host, now, gameType);
    if (typeof player === 'string') return fail(player);
    bySlot.set(slot.slot, player);
    if (
      slot.kind === 'human' &&
      slot.playerId !== host.playerId &&
      player.socketId.length === 0
    ) {
      waitingHumanIds.push(slot.playerId);
    }
  }
  const teams = buildTeams(slots, bySlot);
  if (typeof teams === 'string') return fail(teams);
  return {
    ok: true,
    prepared: {
      game,
      slots,
      teams,
      inputDelayTicks,
      ...(absencePolicy !== undefined ? { absencePolicy } : {}),
      extras,
      waitingHumanIds,
    },
  };
}

/** Bind a joining human into a prepared match. Returns a new prepared match. */
export function fillHumanSlot(
  prepared: PreparedServerMatch,
  player: QueuedPlayer
): PreparedServerMatch | string {
  if (!prepared.waitingHumanIds.includes(player.playerId)) {
    return 'Not a player in this match';
  }
  const teams = prepared.teams.map((team) =>
    team.map((existing) =>
      existing.playerId === player.playerId
        ? { ...player, kind: 'human' as const }
        : existing
    )
  );
  return {
    ...prepared,
    teams,
    waitingHumanIds: prepared.waitingHumanIds.filter(
      (id) => id !== player.playerId
    ),
  };
}
