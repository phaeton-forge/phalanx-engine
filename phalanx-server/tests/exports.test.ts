import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
};

const ROOT_NAMES = [
  'AbsenceConfig',
  'AuthConfig',
  'CommandsBatchEvent',
  'CorsConfig',
  'CustomGameMode',
  'DEFAULT_ABSENCE',
  'DEFAULT_SESSION_TTL_MS',
  'DesyncAction',
  'DesyncConfig',
  'DeterministicRandom',
  'EndMatchResult',
  'FP',
  'FPVector2',
  'FPVector2Interface',
  'FPVector3',
  'FPVector3Interface',
  'FixedPoint',
  'GAME_MODES',
  'GameMode',
  'GameModePreset',
  'GameStartEvent',
  'GameTypeConfig',
  'MatchArchive',
  'MatchErrorEvent',
  'MatchFoundEvent',
  'MatchInfo',
  'MatchLogCancelRequest',
  'MatchLogChunkEvent',
  'MatchLogEntry',
  'MatchLogErrorEvent',
  'MatchLogErrorReason',
  'MatchLogRequest',
  'MatchResumeErrorReason',
  'MatchResumeState',
  'MatchState',
  'PauseConfig',
  'Phalanx',
  'PhalanxConfig',
  'PhalanxEventHandlers',
  'PhalanxEventType',
  'PlayerAbsentEvent',
  'PlayerCommand',
  'PlayerCommandContext',
  'PlayerInfo',
  'QueueStatusEvent',
  'QueuedPlayer',
  'ReconnectConfig',
  'RoomCreatedEvent',
  'RoomErrorEvent',
  'RoomRecoveredEvent',
  'SESSION_TOMBSTONE_TTL_MS',
  'ServerRoomMatchConfig',
  'ServerShutdownEvent',
  'ServerSimEvents',
  'ServerSimHook',
  'SessionClaims',
  'SessionConfig',
  'SessionIssueClaims',
  'SessionSupersededEvent',
  'SessionTokenEvent',
  'SessionTokens',
  'SessionVerifyResult',
  'SlotConfig',
  'StateHashEvent',
  'SubmitCommandsEvent',
  'SubmittedCommand',
  'TickCommands',
  'TickMode',
  'TickSyncEvent',
  'TlsConfig',
  'TokenValidationResult',
  'TokenValidator',
  'TokenValidatorService',
  'createDevValidator',
  'createEndpointValidator',
];

const ROOT_VALUES = [
  'DEFAULT_ABSENCE',
  'DEFAULT_SESSION_TTL_MS',
  'DeterministicRandom',
  'FP',
  'FPVector2',
  'FPVector3',
  'FixedPoint',
  'GAME_MODES',
  'Phalanx',
  'SESSION_TOMBSTONE_TTL_MS',
  'SessionTokens',
  'TokenValidatorService',
  'createDevValidator',
  'createEndpointValidator',
];

const ENTRIES = [
  {
    specifier: '@phalanx-engine/server',
    declaration: 'dist/index.d.ts',
    names: ROOT_NAMES,
    values: ROOT_VALUES,
  },
] as const;

function declarationFor(specifier: string): string {
  const resolved = ts.resolveModuleName(
    specifier,
    path.join(PACKAGE_ROOT, 'package.json'),
    COMPILER_OPTIONS,
    ts.sys
  ).resolvedModule?.resolvedFileName;
  if (resolved === undefined) {
    throw new Error(`unresolved ${specifier}`);
  }
  return resolved;
}

interface ModuleExports {
  readonly names: readonly string[];
  readonly values: readonly string[];
}

function isRuntimeValue(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  const target =
    (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  if ((target.flags & ts.SymbolFlags.Value) === 0) return false;
  const declaration = symbol.declarations?.[0];
  if (declaration === undefined || !ts.isExportSpecifier(declaration)) {
    return true;
  }
  const clause = declaration.parent.parent;
  const typeOnly =
    declaration.isTypeOnly ||
    (ts.isExportDeclaration(clause) && clause.isTypeOnly);
  return !typeOnly || symbol.getName() === target.getName();
}

function namesOf(files: readonly string[]): Map<string, ModuleExports> {
  const program = ts.createProgram([...files], COMPILER_OPTIONS);
  const checker = program.getTypeChecker();
  const names = new Map<string, ModuleExports>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    const symbol =
      source === undefined ? undefined : checker.getSymbolAtLocation(source);
    if (symbol === undefined) {
      throw new Error(`no module symbol for ${file}`);
    }
    const exported = checker.getExportsOfModule(symbol);
    names.set(file, {
      names: exported.map((item) => item.getName()).sort(),
      values: exported
        .filter((item) => isRuntimeValue(item, checker))
        .map((item) => item.getName())
        .sort(),
    });
  }
  return names;
}

const resolved = ENTRIES.map((entry) => ({
  specifier: entry.specifier,
  declaration: entry.declaration,
  names: entry.names,
  values: entry.values,
  file: declarationFor(entry.specifier),
}));
const actual = namesOf(resolved.map((entry) => entry.file));

describe('@phalanx-engine/server exports', () => {
  it('resolves each entry through the exports map', () => {
    for (const entry of resolved) {
      expect(entry.file).toBe(path.join(PACKAGE_ROOT, entry.declaration));
    }
  });

  it('matches the checked-in name snapshot, types included', () => {
    for (const entry of resolved) {
      expect(actual.get(entry.file)?.names).toEqual(entry.names);
      expect(actual.get(entry.file)?.values).toEqual(entry.values);
    }
    expect(
      resolved.map((entry) => actual.get(entry.file)?.names.length)
    ).toEqual([75]);
    expect(
      resolved.map((entry) => actual.get(entry.file)?.values.length)
    ).toEqual([14]);
  });

  it('loads each entry by package name', async () => {
    for (const entry of resolved) {
      const loaded: unknown = await import(entry.specifier);
      expect(Object.keys(loaded as object).sort()).toEqual(entry.values);
    }
  });
});
