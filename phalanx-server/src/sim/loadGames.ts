import { pathToFileURL } from 'node:url';
import { isAbsolute } from 'node:path';
import type { AnyGameDefinition } from '@phalanx-engine/runtime';
import type { GameModuleSpec, PhalanxConfig } from '../types/index.js';

export interface RegisteredGame {
  readonly id: string;
  readonly simVersion: string;
  readonly tickRate: number;
  /** File URL the worker imports. Empty when the game was an object. */
  readonly moduleHref: string;
  readonly exportName?: string;
  readonly definition: AnyGameDefinition;
  readonly inline: boolean;
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
  return record['default'] ?? record['RelayGame'];
}

function assertTick(config: PhalanxConfig, game: RegisteredGame): void {
  const entry = config.gameTypes?.find((item) => item.gameType === game.id);
  const tickRate = entry?.tickRate ?? config.tickRate;
  const tickMode = entry?.tickMode ?? config.tickMode ?? 'continuous';
  if (tickRate !== game.tickRate) {
    throw new Error(
      `game '${game.id}' tickRate ${String(game.tickRate)} does not match server tickRate ${String(tickRate)}`
    );
  }
  if (tickMode !== 'continuous') {
    throw new Error(
      `game '${game.id}' requires continuous tickMode, got '${tickMode}'`
    );
  }
}

/**
 * Import every configured game on the relay so tick rates can be checked
 * and human commands can be prefiltered. The worker imports the module
 * again; the definition object is not posted across the thread.
 */
export async function loadGameCatalog(
  config: PhalanxConfig
): Promise<RegisteredGame[]> {
  const games = config.games ?? [];
  const mode = config.simHost?.mode ?? 'worker';
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
      };
    } else if (isDefinition(entry)) {
      if (mode !== 'inProcess') {
        throw new Error(
          'worker simHost requires each game as { module, export? }'
        );
      }
      registered = {
        id: entry.id,
        simVersion: entry.simVersion,
        tickRate: entry.tickRate,
        moduleHref: '',
        definition: entry,
        inline: true,
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
    assertTick(config, registered);
    catalog.push(registered);
  }
  return catalog;
}
