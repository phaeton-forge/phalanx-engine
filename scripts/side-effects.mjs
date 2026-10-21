import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/**
 * Statement kinds a module may have at top level when its package sets
 * `"sideEffects"`. Anything else (a call, an assignment, a loop, an `if`)
 * runs on import.
 *
 * A variable initializer may build a module-local value: `new`, and a call
 * of a function declared in this file. It may not call an imported binding,
 * construct an imported class, write through an assignment, or run an
 * immediately-invoked function that does any of those. Class static fields,
 * static blocks, `extends` clauses, decorators, enum initializers, and
 * namespace bodies are scanned the same way, because they run when the
 * module is evaluated. Callbacks and method bodies do not.
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

const ASSIGNMENT = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Roots whose methods run outside the module (`globalThis.setTimeout`). */
const GLOBAL_ROOTS = new Set([
  'globalThis',
  'window',
  'self',
  'document',
  'process',
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
  const ctx = {
    file,
    fileName,
    tainted: collectTainted(file),
    found: [],
  };
  for (const statement of file.statements) inspectStatement(statement, ctx);
  return ctx.found;
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

function collectTainted(file) {
  const tainted = new Set();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause == null || clause.isTypeOnly) continue;
      if (clause.name != null) tainted.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings == null) continue;
      if (ts.isNamespaceImport(bindings)) {
        tainted.add(bindings.name.text);
        continue;
      }
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) tainted.add(element.name.text);
      }
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      !statement.isTypeOnly
    ) {
      tainted.add(statement.name.text);
    }
  }
  return tainted;
}

function inspectStatement(statement, ctx) {
  if (ts.canHaveDecorators(statement)) walkDecorators(statement, ctx);
  if (ts.isClassDeclaration(statement)) {
    inspectClass(statement, ctx);
    return;
  }
  if (ts.isModuleDeclaration(statement)) {
    inspectModule(statement, ctx);
    return;
  }
  if (ts.isEnumDeclaration(statement)) {
    for (const member of statement.members) {
      if (member.initializer != null) walk(member.initializer, ctx);
    }
    return;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer != null) walk(declaration.initializer, ctx);
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer != null &&
        isTaintedReference(declaration.initializer, ctx.tainted)
      ) {
        ctx.tainted.add(declaration.name.text);
      }
    }
    return;
  }
  if (DECLARATION_KINDS.has(statement.kind)) return;
  if (
    ts.isExportAssignment(statement) &&
    ts.isIdentifier(statement.expression)
  ) {
    return;
  }
  report(statement, ctx);
}

function inspectClass(node, ctx) {
  if (ts.canHaveDecorators(node)) walkDecorators(node, ctx);
  for (const clause of node.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const type of clause.types) walk(type.expression, ctx);
  }
  for (const member of node.members) {
    if (ts.canHaveDecorators(member)) walkDecorators(member, ctx);
    if (ts.isClassStaticBlockDeclaration(member)) {
      const inner = childContext(ctx);
      for (const statement of member.body.statements) {
        inspectStatement(statement, inner);
      }
      continue;
    }
    if (
      ts.isPropertyDeclaration(member) &&
      isStatic(member) &&
      member.initializer != null
    ) {
      walk(member.initializer, ctx);
    }
  }
}

function inspectModule(node, ctx) {
  if (isAmbient(node)) return;
  const body = node.body;
  if (body == null) return;
  if (ts.isModuleBlock(body)) {
    const inner = childContext(ctx);
    for (const statement of body.statements) inspectStatement(statement, inner);
    return;
  }
  if (ts.isModuleDeclaration(body)) inspectModule(body, ctx);
}

function walk(node, ctx) {
  if (node == null || isDeferred(node)) return;
  if (ts.isClassExpression(node) || ts.isClassDeclaration(node)) {
    inspectClass(node, ctx);
    return;
  }
  if (ts.isCallExpression(node)) {
    const callee = unwrapCallee(node.expression);
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(node, ctx);
    } else if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
      walkInvoked(callee, ctx);
    } else if (isTaintedCallee(node.expression, ctx.tainted)) {
      report(node, ctx);
    } else {
      walk(node.expression, ctx);
    }
    for (const argument of node.arguments) walk(argument, ctx);
    return;
  }
  if (ts.isNewExpression(node)) {
    if (isTaintedCallee(node.expression, ctx.tainted)) report(node, ctx);
    walk(node.expression, ctx);
    for (const argument of node.arguments ?? []) walk(argument, ctx);
    return;
  }
  if (ts.isTaggedTemplateExpression(node)) {
    if (isTaintedCallee(node.tag, ctx.tainted)) report(node, ctx);
    walk(node.tag, ctx);
    walk(node.template, ctx);
    return;
  }
  if (
    ts.isBinaryExpression(node) &&
    ASSIGNMENT.has(node.operatorToken.kind)
  ) {
    report(node, ctx);
    walk(node.left, ctx);
    walk(node.right, ctx);
    return;
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    if (
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken
    ) {
      report(node, ctx);
    }
    walk(node.operand, ctx);
    return;
  }
  if (ts.isDeleteExpression(node)) {
    report(node, ctx);
    walk(node.expression, ctx);
    return;
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) walk(property.initializer, ctx);
      else if (ts.isSpreadAssignment(property)) walk(property.expression, ctx);
    }
    return;
  }
  ts.forEachChild(node, (child) => walk(child, ctx));
}

function walkInvoked(fn, ctx) {
  const inner = childContext(ctx);
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
    walk(fn.body, inner);
    return;
  }
  if (fn.body != null && ts.isBlock(fn.body)) {
    for (const statement of fn.body.statements) {
      inspectStatement(statement, inner);
    }
  }
}

function childContext(ctx) {
  return { ...ctx, tainted: new Set(ctx.tainted) };
}

function walkDecorators(node, ctx) {
  const decorators = ts.getDecorators(node);
  if (decorators == null) return;
  for (const decorator of decorators) walk(decorator.expression, ctx);
}

function isDeferred(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function isStatic(node) {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword
    ) === true
  );
}

function isAmbient(node) {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword
    ) === true
  );
}

function isTaintedReference(expression, tainted) {
  const node = unwrapCallee(expression);
  if (ts.isIdentifier(node)) return tainted.has(node.text);
  if (isAccess(node)) return isTaintedReference(node.expression, tainted);
  return false;
}

function isTaintedCallee(expression, tainted) {
  const node = unwrapCallee(expression);
  if (ts.isIdentifier(node)) {
    return tainted.has(node.text) || GLOBAL_ROOTS.has(node.text);
  }
  if (!isAccess(node)) return false;
  const root = rootIdentifier(node);
  return root !== undefined && (tainted.has(root) || GLOBAL_ROOTS.has(root));
}

function rootIdentifier(expression) {
  let node = unwrapCallee(expression);
  while (isAccess(node)) node = unwrapCallee(node.expression);
  return ts.isIdentifier(node) ? node.text : undefined;
}

function isAccess(node) {
  return (
    ts.isPropertyAccessExpression(node) ||
    ts.isPropertyAccessChain(node) ||
    ts.isElementAccessExpression(node)
  );
}

function unwrap(expression) {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function unwrapCallee(expression) {
  let node = unwrap(expression);
  while (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    node = unwrap(node.right);
  }
  return node;
}

function report(node, ctx) {
  const { line } = ctx.file.getLineAndCharacterOfPosition(node.getStart(ctx.file));
  const text = node.getText(ctx.file).split('\n')[0];
  ctx.found.push(`${ctx.fileName}:${line + 1}: ${text}`);
}
