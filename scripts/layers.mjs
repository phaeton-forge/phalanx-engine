/**
 * Layer matrix for the workspace. Both dependency checks read this file.
 * Package layers come only from each package.json `phalanx.layer`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const LAYERS = [
  'domain',
  'contracts',
  'application',
  'infrastructure',
  'composition',
  'app',
];

/** Domain packages may depend only on the packages listed here. */
export const DOMAIN_EDGES = {
  math: [],
  ecs: ['math'],
  physics: ['ecs', 'math'],
  abilities: ['ecs', 'math'],
};

const APPLICATION_DOMAIN = ['ecs', 'math'];

export function shortName(packageName) {
  const slash = packageName.lastIndexOf('/');
  if (packageName.startsWith('@') && slash > 0) {
    return packageName.slice(slash + 1);
  }
  return packageName;
}

/**
 * @param {{ layer: string, short: string }} from
 * @param {{ layer: string, short: string }} to
 */
export function allowsDependency(from, to) {
  if (from.layer === 'app') return true;
  if (to.layer === 'app' || to.layer === 'composition') return false;
  switch (from.layer) {
    case 'domain':
      return (
        to.layer === 'domain' &&
        (DOMAIN_EDGES[from.short] ?? []).includes(to.short)
      );
    case 'contracts':
      return false;
    case 'application':
      if (to.layer === 'contracts') return true;
      return to.layer === 'domain' && APPLICATION_DOMAIN.includes(to.short);
    case 'infrastructure':
      return to.layer === 'contracts';
    case 'composition':
      return true;
    default:
      return false;
  }
}

/**
 * Planned adapter edge: the runtime `./net` subpath wraps the network
 * client. Every other adapter follows the matrix.
 */
export function allowsAdapterDependency(pkgShort, subpath, to) {
  return pkgShort === 'runtime' && subpath === './net' && to.short === 'client';
}

/** True when `pkg` or one of its `phalanx.subpaths` adapters may use `to`. */
function packageOrAdapterAllows(pkg, to) {
  if (allowsDependency({ layer: pkg.layer, short: pkg.short }, to)) {
    return true;
  }
  const subpaths = pkg.raw.phalanx?.subpaths;
  if (!subpaths || typeof subpaths !== 'object') return false;
  return Object.entries(subpaths).some(
    ([subpath, layer]) =>
      layerKnown(layer) &&
      (allowsDependency({ layer, short: pkg.short }, to) ||
        allowsAdapterDependency(pkg.short, subpath, to))
  );
}

export function loadWorkspace(rootDir) {
  const root = rootDir;
  const text = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const folders = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?\s*$/);
    if (match?.[1]) folders.push(match[1]);
  }
  return folders.map((folder) => {
    const dir = join(root, folder);
    const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const name = typeof raw.name === 'string' ? raw.name : folder;
    const layer =
      typeof raw.phalanx?.layer === 'string' ? raw.phalanx.layer : undefined;
    return {
      folder,
      dir,
      // Rule paths are relative to rootDir. Run depcruise with that cwd.
      rel: relative(rootDir, dir).split('\\').join('/'),
      name,
      short: shortName(name),
      raw,
      layer,
    };
  });
}

function layerKnown(layer) {
  return typeof layer === 'string' && LAYERS.includes(layer);
}

export function checkLayerDeps(rootDir) {
  const packages = loadWorkspace(rootDir);
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const violations = [];

  for (const pkg of packages) {
    if (!layerKnown(pkg.layer)) {
      violations.push(`${pkg.name}: package.json has no phalanx.layer`);
    }
    const subpaths = pkg.raw.phalanx?.subpaths;
    if (subpaths && typeof subpaths === 'object') {
      for (const [key, value] of Object.entries(subpaths)) {
        if (!layerKnown(value)) {
          violations.push(
            `${pkg.name}: phalanx.subpaths ${key} is not a layer`
          );
        }
      }
    }
  }

  for (const pkg of packages) {
    if (!layerKnown(pkg.layer)) continue;
    for (const field of ['dependencies', 'peerDependencies']) {
      const deps = pkg.raw[field];
      if (!deps || typeof deps !== 'object') continue;
      const label =
        field === 'peerDependencies' ? 'peerDependency' : 'dependency';
      for (const depName of Object.keys(deps)) {
        const target = byName.get(depName);
        if (!target || !layerKnown(target.layer)) continue;
        const to = { layer: target.layer, short: target.short };
        const optionalPeer =
          field === 'peerDependencies' &&
          pkg.raw.peerDependenciesMeta?.[depName]?.optional === true;
        const allowed = optionalPeer
          ? packageOrAdapterAllows(pkg, to)
          : allowsDependency({ layer: pkg.layer, short: pkg.short }, to);
        if (!allowed) {
          violations.push(
            `${pkg.name}: ${label} ${depName} violates layer ${pkg.layer} → ${target.layer}`
          );
        }
      }
    }
  }

  const edges = new Map(packages.map((pkg) => [pkg.name, []]));
  for (const pkg of packages) {
    for (const field of [
      'dependencies',
      'peerDependencies',
      'devDependencies',
    ]) {
      const deps = pkg.raw[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const depName of Object.keys(deps)) {
        if (!byName.has(depName) || depName === pkg.name) continue;
        edges.get(pkg.name)?.push(depName);
      }
    }
  }
  for (const cycle of findCycles([...edges.keys()], edges)) {
    violations.push(
      `${cycle[0]}: workspace dependency cycle ${cycle.join(' → ')}`
    );
  }

  violations.sort();
  return violations;
}

function findCycles(nodes, edges) {
  const color = new Map();
  const stack = [];
  const seen = new Set();
  const cycles = [];

  function record(startAt) {
    const cycle = stack.slice(startAt);
    cycle.push(cycle[0]);
    const body = cycle.slice(0, -1);
    const minAt = body.reduce(
      (best, name, index) => (name < body[best] ? index : best),
      0
    );
    const rotated = body.slice(minAt).concat(body.slice(0, minAt));
    const key = rotated.join('→');
    if (seen.has(key)) return;
    seen.add(key);
    cycles.push([...rotated, rotated[0]]);
  }

  function dfs(node) {
    color.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const state = color.get(next) ?? 0;
      if (state === 0) dfs(next);
      else if (state === 1) record(stack.indexOf(next));
    }
    stack.pop();
    color.set(node, 2);
  }

  for (const node of nodes) {
    if ((color.get(node) ?? 0) === 0) dfs(node);
  }
  return cycles;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exportImportTarget(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.import === 'string') {
    return value.import;
  }
  return undefined;
}

function adaptersOf(pkg) {
  const subpaths = pkg.raw.phalanx?.subpaths;
  if (!subpaths || typeof subpaths !== 'object') return [];
  const exportsMap = pkg.raw.exports;
  const adapters = [];
  for (const [subpath, layer] of Object.entries(subpaths)) {
    const target = exportImportTarget(exportsMap?.[subpath]);
    if (typeof target !== 'string') {
      throw new Error(
        `${pkg.name}: phalanx.subpaths ${subpath} has no exports import`
      );
    }
    const asSrc = target.replace(/^\.\//, '').replace(/^dist\//, 'src/');
    const folder = asSrc.replace(/\/[^/]+$/, '');
    adapters.push({ subpath, layer, folder });
  }
  return adapters;
}

function rootSourcePattern(pkg, adapters) {
  if (adapters.length === 0) return `^${escapeRe(pkg.rel)}/src/`;
  const folders = adapters
    .map((adapter) => escapeRe(adapter.folder.replace(/^src\//, '')))
    .join('|');
  return `^${escapeRe(pkg.rel)}/src/(?!(?:${folders})/)`;
}

function targetPattern(pkg) {
  return `(?:^${escapeRe(pkg.rel)}/|node_modules/${escapeRe(pkg.name)}/|^${escapeRe(pkg.name)}(?:/|$))`;
}

function sourceGroups(packages) {
  const groups = [];
  for (const pkg of packages) {
    if (!layerKnown(pkg.layer)) continue;
    const adapters = adaptersOf(pkg);
    groups.push({
      pkg,
      layer: pkg.layer,
      from: rootSourcePattern(pkg, adapters),
      isAdapter: false,
    });
    for (const adapter of adapters) {
      if (!layerKnown(adapter.layer)) continue;
      groups.push({
        pkg,
        layer: adapter.layer,
        from: `^${escapeRe(pkg.rel)}/${escapeRe(adapter.folder)}/`,
        isAdapter: true,
        subpath: adapter.subpath,
      });
    }
  }
  return groups;
}

function isomorphicFrom(packages) {
  const patterns = [];
  for (const pkg of packages) {
    if (pkg.layer === 'domain' || pkg.layer === 'contracts') {
      patterns.push(`^${escapeRe(pkg.rel)}/src/`);
    } else if (pkg.layer === 'application') {
      patterns.push(rootSourcePattern(pkg, adaptersOf(pkg)));
    }
  }
  return patterns;
}

function layerRules(packages) {
  const rules = [];
  for (const group of sourceGroups(packages)) {
    const byLayer = new Map();
    for (const target of packages) {
      if (target.name === group.pkg.name) continue;
      if (!layerKnown(target.layer)) continue;
      const to = { layer: target.layer, short: target.short };
      if (
        allowsDependency({ layer: group.layer, short: group.pkg.short }, to) ||
        (group.isAdapter &&
          allowsAdapterDependency(group.pkg.short, group.subpath, to))
      ) {
        continue;
      }
      const list = byLayer.get(target.layer) ?? [];
      list.push(target);
      byLayer.set(target.layer, list);
    }
    for (const [toLayer, targets] of byLayer) {
      if (targets.length === 0) continue;
      rules.push({
        name: `layer-${group.layer}-to-${toLayer}`,
        severity: 'error',
        from: { path: group.from },
        to: { path: targets.map(targetPattern).join('|') },
      });
    }
  }

  for (const pkg of packages) {
    for (const adapter of adaptersOf(pkg)) {
      rules.push({
        name: 'layer-root-to-subpath',
        severity: 'error',
        from: { path: rootSourcePattern(pkg, adaptersOf(pkg)) },
        to: {
          path: `^${escapeRe(pkg.rel)}/${escapeRe(adapter.folder)}/`,
        },
      });
    }
  }
  return rules;
}

function relativeRules(packages, allow) {
  const rules = [];
  const allowed = allow ?? [];
  for (const pkg of packages) {
    const others = packages.filter((item) => item.name !== pkg.name);
    if (others.length === 0) continue;
    const to = others.map((item) => `^${escapeRe(item.rel)}/`).join('|');
    const ownTests = `^${escapeRe(pkg.rel)}/tests/`;
    const exceptions = allowed.filter((entry) =>
      entry.from.startsWith(`${pkg.rel}/`)
    );
    const from = { path: ownTests };
    if (exceptions.length > 0) {
      from.pathNot = exceptions.map((entry) => `^${escapeRe(entry.from)}$`);
    }
    rules.push({
      name: 'no-cross-package-relative',
      severity: 'error',
      from,
      to: { path: to, dependencyTypes: ['local'] },
    });
    for (const entry of exceptions) {
      const stripped = entry.to.replace(/\.js$/, '');
      rules.push({
        name: 'no-cross-package-relative',
        severity: 'error',
        comment: 'golden fixture, runtime → dev integration would be a cycle',
        from: { path: `^${escapeRe(entry.from)}$` },
        to: {
          path: to,
          pathNot: `^${escapeRe(stripped)}(?:\\.js|\\.ts)?$`,
          dependencyTypes: ['local'],
        },
      });
    }
  }
  return rules;
}

function isomorphicRules(packages) {
  const from = isomorphicFrom(packages);
  if (from.length === 0) return [];
  return [
    {
      name: 'isomorphic-host',
      severity: 'error',
      from: { path: from },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'isomorphic-host',
      severity: 'error',
      from: { path: from },
      to: { path: '^socket\\.io(?:-client)?(?:/|$)' },
    },
  ];
}

export function buildDepcruiseConfig(rootDir, options = {}) {
  const packages = loadWorkspace(rootDir);
  const allow = options.allow ?? [];
  return {
    forbidden: [
      ...layerRules(packages),
      ...relativeRules(packages, allow),
      ...isomorphicRules(packages),
    ],
    options: {
      tsPreCompilationDeps: true,
      doNotFollow: { path: 'node_modules|/dist/' },
      enhancedResolveOptions: {
        exportsFields: ['exports'],
        conditionNames: ['import', 'types', 'default'],
      },
    },
  };
}

export function workspacePackageDirs(rootDir) {
  return loadWorkspace(rootDir).map((pkg) => pkg.folder);
}

export function packageJsonExists(rootDir, folder) {
  return existsSync(join(rootDir, folder, 'package.json'));
}
