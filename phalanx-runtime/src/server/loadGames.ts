import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
import type { AnyGameDefinition } from '../game/GameDefinition.js';
import type { GameModuleSpec, ServerSimConfig } from './serverSimConfig.js';

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

export interface RegisteredGame {
  readonly id: string;
  readonly simVersion: string;
  readonly tickRate: number;
  /** File URL the worker imports. Empty when the game was an object. */
  readonly moduleHref: string;
  readonly exportName?: string;
  readonly definition: AnyGameDefinition;
  readonly inline: boolean;
  /** Client integer keys copied into the runner config. */
  readonly configKeys: readonly string[];
}

function isModuleSpec(value: unknown): value is GameModuleSpec {
  if (typeof value !== 'object' || value === null) return false;
  const modulePath = (value as { module?: unknown }).module;
  return typeof modulePath === 'string' && modulePath.length > 0;
}

function isDefinition(value: unknown): value is AnyGameDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as {
    id?: unknown;
    tickRate?: unknown;
    commands?: unknown;
  };
  if (typeof record.id !== 'string' || record.id.length === 0) return false;
  if (typeof record.tickRate !== 'number') return false;
  return typeof record.commands === 'object' && record.commands !== null;
}

export function moduleHref(modulePath: string): string {
  if (modulePath.startsWith('file:')) return modulePath;
  if (isAbsolute(modulePath)) return pathToFileURL(modulePath).href;
  return modulePath;
}

function pickExport(
  imported: unknown,
  exportName: string | undefined
): unknown {
  if (typeof imported !== 'object' || imported === null) return undefined;
  const record = imported as { readonly [key: string]: unknown };
  if (exportName !== undefined && exportName.length > 0) {
    return record[exportName];
  }
  return record['default'];
}

function readConfigKeys(entry: GameModuleSpec): readonly string[] {
  const keys = entry.configKeys;
  if (keys === undefined) return [];
  if (!Array.isArray(keys)) {
    throw new Error(
      `game module '${entry.module}' configKeys must be an array`
    );
  }
  const allowed: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(
        `game module '${entry.module}' configKeys must be non-empty strings`
      );
    }
    if (ENGINE_MATCH_CONFIG_KEYS.has(key) || seen.has(key)) {
      throw new Error(
        `game module '${entry.module}' configKeys cannot include '${key}'`
      );
    }
    seen.add(key);
    allowed.push(key);
  }
  return allowed;
}

/**
 * Import every configured game so the host can run it. The worker imports
 * the module again; the definition object is not posted across the thread.
 */
export async function loadGameCatalog(
  config: ServerSimConfig
): Promise<RegisteredGame[]> {
  const games = config.games;
  const mode = config.mode ?? 'worker';
  const catalog: RegisteredGame[] = [];
  const seen = new Set<string>();
  for (const entry of games) {
    let registered: RegisteredGame;
    if (isModuleSpec(entry)) {
      const href = moduleHref(entry.module);
      const imported: unknown = await import(href);
      const definition = pickExport(imported, entry.export);
      if (!isDefinition(definition)) {
        throw new Error(
          `module '${entry.module}' did not export a game definition`
        );
      }
      registered = {
        id: definition.id,
        simVersion: definition.simVersion,
        tickRate: definition.tickRate,
        moduleHref: href,
        ...(entry.export !== undefined ? { exportName: entry.export } : {}),
        definition,
        inline: false,
        configKeys: readConfigKeys(entry),
      };
    } else if (isDefinition(entry)) {
      if (mode !== 'inProcess') {
        throw new Error(
          'worker mode requires each game as { module, export? }'
        );
      }
      registered = {
        id: entry.id,
        simVersion: entry.simVersion,
        tickRate: entry.tickRate,
        moduleHref: '',
        definition: entry,
        inline: true,
        configKeys: [],
      };
    } else {
      throw new Error(
        'games entries must be a GameDefinition or { module, export? }'
      );
    }
    if (seen.has(registered.id)) {
      throw new Error(`duplicate game id '${registered.id}'`);
    }
    seen.add(registered.id);
    catalog.push(registered);
  }
  return catalog;
}
