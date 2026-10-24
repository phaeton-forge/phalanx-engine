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

const ROOT_NAMES = [
  'ABILITY_ACTIVATED_EVENT',
  'Abilities',
  'AbilityActivatedEvent',
  'AbilityActivationContext',
  'AbilityActivationRequest',
  'AbilityActivationSystem',
  'AbilityDef',
  'AbilityHook',
  'AbilityHookExecutorSystem',
  'AbilityHooksRegistry',
  'AbilityOwner',
  'AbilityOwnerInit',
  'AbilityOwnerState',
  'AbilityRegistry',
  'AbilityRuntimeState',
  'AbilityStateReader',
  'AbilitySystem',
  'AbilitySystemDefinitions',
  'AbilitySystemFacade',
  'AbilitySystemPipeline',
  'AbilitySystemRegistries',
  'AbilitySystemRuntime',
  'ActiveEffectInstance',
  'ActiveEffects',
  'ActiveEffectsState',
  'AttributeAggregationSystem',
  'AttributeClampMode',
  'AttributeDef',
  'AttributeInitializer',
  'AttributeRegistry',
  'AttributeValue',
  'Attributes',
  'AttributesState',
  'CreateAbilitySystemConfig',
  'Cue',
  'CueBufferCleanupSystem',
  'CueConfig',
  'CueContext',
  'CueDispatchSystem',
  'CueEvent',
  'CueFactory',
  'CuePhase',
  'CuePresentationSystem',
  'EffectApplicationSystem',
  'EffectCueSpec',
  'EffectCues',
  'EffectDef',
  'EffectDefInput',
  'EffectRegistry',
  'EffectTickSystem',
  'EffectType',
  'GAMEPLAY_CUE_EVENT',
  'GameplayCueBuffer',
  'GameplayCueBufferView',
  'GameplayCueDispatchedEvent',
  'GameplayTags',
  'GameplayTagsState',
  'InitialEffect',
  'InstanceIdCounter',
  'MagnitudeCalcContext',
  'MagnitudeCalculation',
  'Modifier',
  'ModifierOp',
  'NO_SOURCE_ENTITY_ID',
  'PendingEffectAdd',
  'ProvidedTarget',
  'ResolvedAbilityActivationRecord',
  'TargetFilter',
  'TargetOrigin',
  'TargetResolutionInput',
  'TargetResolutionResult',
  'TargetResolver',
  'TargetSpec',
  'abilityOwnerOf',
  'activeEffectsOf',
  'appendGameplayCueEvents',
  'attributesOf',
  'createAbilitySystem',
  'createAbilitySystemRegistries',
  'createAbilitySystemRuntime',
  'createGameplayCueBuffer',
  'defineAbility',
  'defineAbilitySystem',
  'defineAttribute',
  'defineEffect',
  'gameplayCueKey',
  'gameplayTagsOf',
  'getCueIdsForPhase',
];

const ROOT_VALUES = [
  'ABILITY_ACTIVATED_EVENT',
  'Abilities',
  'AbilityActivationSystem',
  'AbilityHookExecutorSystem',
  'AbilityHooksRegistry',
  'AbilityOwner',
  'AbilityRegistry',
  'AbilitySystemFacade',
  'ActiveEffects',
  'AttributeAggregationSystem',
  'AttributeRegistry',
  'Attributes',
  'Cue',
  'CueBufferCleanupSystem',
  'CueDispatchSystem',
  'CuePresentationSystem',
  'EffectApplicationSystem',
  'EffectRegistry',
  'EffectTickSystem',
  'GAMEPLAY_CUE_EVENT',
  'GameplayTags',
  'InstanceIdCounter',
  'NO_SOURCE_ENTITY_ID',
  'TargetResolver',
  'abilityOwnerOf',
  'activeEffectsOf',
  'appendGameplayCueEvents',
  'attributesOf',
  'createAbilitySystem',
  'createAbilitySystemRegistries',
  'createAbilitySystemRuntime',
  'createGameplayCueBuffer',
  'defineAbility',
  'defineAbilitySystem',
  'defineAttribute',
  'defineEffect',
  'gameplayCueKey',
  'gameplayTagsOf',
  'getCueIdsForPhase',
];

const ENTRIES = [
  {
    specifier: '@phalanx-engine/abilities',
    declaration: 'dist/index.d.ts',
    names: ROOT_NAMES,
    values: ROOT_VALUES,
  },
] as const;

const resolved = ENTRIES.map((entry) => ({
  specifier: entry.specifier,
  declaration: entry.declaration,
  names: entry.names,
  values: entry.values,
  file: declarationFor(entry.specifier),
}));
const actual = namesOf(resolved.map((entry) => entry.file));

describe('@phalanx-engine/abilities exports', () => {
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
    ).toEqual([88]);
    expect(
      resolved.map((entry) => actual.get(entry.file)?.values.length)
    ).toEqual([39]);
  });

  it('loads each entry by package name', async () => {
    for (const entry of resolved) {
      const loaded: unknown = await import(entry.specifier);
      expect(Object.keys(loaded as object).sort()).toEqual(entry.values);
    }
  });
});
