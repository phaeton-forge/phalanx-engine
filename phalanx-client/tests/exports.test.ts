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
  'AuthAdapter',
  'AuthError',
  'AuthManager',
  'AuthManagerConfig',
  'AuthResult',
  'AuthState',
  'AuthStorage',
  'AuthUser',
  'BrowserLifecycleHandle',
  'BrowserLifecycleHandlers',
  'CallbackParams',
  'ClientState',
  'CommandFlushCallback',
  'CommandsBatch',
  'CommandsBatchEvent',
  'ConnectionState',
  'CountdownEvent',
  'DEFAULT_RECOVER_TIMEOUT_BUDGET',
  'DesyncConfig',
  'DesyncDetector',
  'DesyncEvent',
  'DeterministicRandom',
  'DiscordOAuthConfig',
  'EventEmitter',
  'FP',
  'FPVector2',
  'FPVector2Interface',
  'FPVector3',
  'FPVector3Interface',
  'FixedPoint',
  'FrameHandler',
  'GamePausedEvent',
  'GameResumedEvent',
  'GameStartEvent',
  'GoogleOAuthAdapter',
  'GoogleOAuthConfig',
  'HashComparisonEvent',
  'KeyValueStorage',
  'LocalStorageAdapter',
  'LogChunk',
  'LoginOptions',
  'MatchEndEvent',
  'MatchFoundEvent',
  'MatchLogError',
  'MatchLogErrorEvent',
  'MatchLogErrorReason',
  'MatchLogWireErrorReason',
  'MatchPlayerInfo',
  'MatchResumeErrorReason',
  'MatchResumeRejected',
  'MatchResumeState',
  'MatchResumeWireErrorReason',
  'MatchSession',
  'MatchSessionStore',
  'MemoryKeyValueStorage',
  'MemoryStorageAdapter',
  'PauseConfig',
  'PauseHandler',
  'PersistedRoom',
  'PhalanxAuthConfig',
  'PhalanxAuthState',
  'PhalanxAuthUser',
  'PhalanxClient',
  'PhalanxClientConfig',
  'PhalanxClientEvents',
  'PhalanxError',
  'PhalanxRoomRecoveryConfig',
  'PlayerCommand',
  'PlayerDisconnectedEvent',
  'PlayerReadyEvent',
  'PlayerReconnectedEvent',
  'QueueStatusEvent',
  'ReconnectStateEvent',
  'ReconnectStatusEvent',
  'RecoverTimeoutBudget',
  'RecoveryClientPort',
  'RenderLoop',
  'RenderLoopConfig',
  'RoomCancelledEvent',
  'RoomCreatedEvent',
  'RoomErrorEvent',
  'RoomExpiredEvent',
  'RoomPersistence',
  'RoomPersistenceConfig',
  'RoomRecoveredEvent',
  'RoomRecoveryConfig',
  'RoomRecoveryController',
  'RoomRecoveryControllerEvents',
  'RoomRecoveryPhase',
  'RoomRecoveryStatusEvent',
  'RoomRole',
  'RoomTerminatedEvent',
  'ServerShutdownEvent',
  'SessionSupersededEvent',
  'SessionTokenEvent',
  'SocketManager',
  'SocketManagerCallbacks',
  'SocketManagerConfig',
  'SocketTransport',
  'StateHasher',
  'SteamAuthConfig',
  'StoredAuthData',
  'SubmitCommandsAck',
  'TickCommandsHistory',
  'TickHandler',
  'TickSyncEvent',
  'Unsubscribe',
  'armBrowserLifecycle',
  'defaultKeyValueStorage',
  'deriveMatchRandomSeed',
  'getRecoverTimeoutMs',
  'isMobileBrowser',
  'loadOrCreateGuestPlayerId',
  'pickMobileFriendlyTransports',
  'resolveMatchRandomSeed',
];

const AUTH_NAMES = [
  'AuthAdapter',
  'AuthError',
  'AuthManager',
  'AuthManagerConfig',
  'AuthResult',
  'AuthState',
  'AuthStorage',
  'AuthUser',
  'CallbackParams',
  'DiscordOAuthConfig',
  'GoogleOAuthAdapter',
  'GoogleOAuthConfig',
  'LocalStorageAdapter',
  'LoginOptions',
  'MemoryStorageAdapter',
  'SteamAuthConfig',
  'StoredAuthData',
  'computeCodeChallenge',
];

const ENTRIES = [
  {
    specifier: '@phalanx-engine/client',
    declaration: 'dist/index.d.ts',
    names: ROOT_NAMES,
  },
  {
    specifier: '@phalanx-engine/client/auth',
    declaration: 'dist/auth/index.d.ts',
    names: AUTH_NAMES,
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
  file: declarationFor(entry.specifier),
}));
const actual = namesOf(resolved.map((entry) => entry.file));

describe('@phalanx-engine/client exports', () => {
  it('resolves each entry through the exports map', () => {
    for (const entry of resolved) {
      expect(entry.file).toBe(path.join(PACKAGE_ROOT, entry.declaration));
    }
  });

  it('matches the checked-in name snapshot, types included', () => {
    for (const entry of resolved) {
      expect(actual.get(entry.file)?.names).toEqual(entry.names);
    }
    expect(
      resolved.map((entry) => actual.get(entry.file)?.names.length)
    ).toEqual([115, 18]);
  });

  it('loads each entry by package name', async () => {
    for (const entry of resolved) {
      const loaded: unknown = await import(entry.specifier);
      const values = actual.get(entry.file)?.values;
      if (values === undefined) {
        throw new Error(entry.specifier);
      }
      expect(Object.keys(loaded as object).sort()).toEqual(values);
    }
  });
});
