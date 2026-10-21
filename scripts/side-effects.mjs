import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/**
 * Statement kinds a module may have at top level when its package says
 * `"sideEffects": false`. Variable statements are allowed: their
 * initializers only fill module-local values. Any other statement (a call,
 * an assignment, a loop, an `if`) is work done on import.
 */
const DECLARATION_KINDS = new Set([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.EmptyStatement,
]);

/**
 * Top-level statements in `source` that run work on import.
 * Returns `file:line: text` entries; empty when the module is clean.
 */
export function findImportWork(source, fileName) {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const found = [];
  for (const statement of file.statements) {
    if (DECLARATION_KINDS.has(statement.kind)) continue;
    if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression)
    ) {
      continue;
    }
    const { line } = file.getLineAndCharacterOfPosition(statement.getStart());
    const text = statement.getText().split('\n')[0];
    found.push(`${fileName}:${line + 1}: ${text}`);
  }
  return found;
}

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(path);
    }
  }
  return files;
}

/** `./dist/server/simWorker.js` -> `src/server/simWorker.ts`. */
function sourceOf(distPath) {
  return distPath
    .replace(/^\.\//, '')
    .replace(/^dist\//, 'src/')
    .replace(/\.js$/, '.ts');
}

/**
 * Check every workspace package that sets `sideEffects` to `false` or to
 * a file list. Files in the list are entry points that may do work.
 */
export function checkSideEffects(root) {
  const found = [];
  const checked = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('phalanx-')) continue;
    const dir = join(root, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const field = manifest.sideEffects;
    if (field !== false && !Array.isArray(field)) continue;
    const allowed = new Set(
      (Array.isArray(field) ? field : []).map((path) => sourceOf(path))
    );
    checked.push(manifest.name);
    for (const path of sourceFiles(join(dir, 'src'))) {
      const local = relative(dir, path).split(sep).join('/');
      if (allowed.has(local)) continue;
      const source = readFileSync(path, 'utf8');
      found.push(...findImportWork(source, relative(root, path)));
    }
  }
  return { checked, found };
}
