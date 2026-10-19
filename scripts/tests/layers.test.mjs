import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildDepcruiseConfig, checkLayerDeps } from '../layers.mjs';

const FIXTURE = join(process.cwd(), 'scripts/tests/fixtures');

const EXPECTED_RULES = [
  'layer-domain-to-contracts',
  'layer-domain-to-application',
  'layer-domain-to-infrastructure',
  'layer-domain-to-composition',
  'layer-domain-to-app',
  'layer-domain-to-domain',
  'layer-contracts-to-domain',
  'layer-contracts-to-contracts',
  'layer-contracts-to-application',
  'layer-contracts-to-infrastructure',
  'layer-contracts-to-composition',
  'layer-contracts-to-app',
  'layer-application-to-domain',
  'layer-application-to-application',
  'layer-application-to-infrastructure',
  'layer-application-to-composition',
  'layer-application-to-app',
  'layer-infrastructure-to-domain',
  'layer-infrastructure-to-application',
  'layer-infrastructure-to-infrastructure',
  'layer-infrastructure-to-composition',
  'layer-infrastructure-to-app',
  'layer-composition-to-app',
  'layer-composition-to-composition',
  'layer-root-to-subpath',
  'isomorphic-host',
  'no-cross-package-relative',
];

function cruise(config) {
  const dir = mkdtempSync(join(tmpdir(), 'layers-config-'));
  const configFile = join(dir, 'depcruise.config.cjs');
  writeFileSync(configFile, `module.exports = ${JSON.stringify(config)};\n`);
  const result = spawnSync(
    join(process.cwd(), 'node_modules', '.bin', 'depcruise'),
    ['--config', configFile, '--output-type', 'json', FIXTURE],
    { cwd: process.cwd(), encoding: 'utf8' }
  );
  rmSync(dir, { recursive: true, force: true });
  const stdout = result.stdout ?? '';
  const parsed = stdout.trim() === '' ? undefined : JSON.parse(stdout);
  return { status: result.status, stderr: result.stderr ?? '', parsed };
}

test('check-layer-deps reports each package.json violation and passes clean packages', () => {
  const lines = checkLayerDeps(FIXTURE);
  assert.ok(
    lines.includes('@fixture/missing: package.json has no phalanx.layer')
  );
  assert.ok(
    lines.some(
      (line) =>
        line.includes('@fixture/client') &&
        line.includes('peerDependency @fixture/ecs') &&
        line.includes('infrastructure → domain')
    )
  );
  assert.equal(
    lines.some((line) => line.startsWith('@fixture/ecs:')),
    false
  );
  assert.equal(
    lines.some((line) => line.startsWith('@fixture/playground:')),
    false
  );
});

test('generated rules catch each matrix violation exactly once', () => {
  const config = buildDepcruiseConfig(FIXTURE, { allow: [] });
  assert.equal(config.options.tsPreCompilationDeps, true);
  const names = new Set(config.forbidden.map((rule) => rule.name));
  for (const name of EXPECTED_RULES) {
    assert.equal(names.has(name), true, `missing rule ${name}`);
  }

  const result = cruise(config);
  assert.ok(result.parsed, result.stderr);
  const violations = result.parsed.summary?.violations ?? [];
  const byRule = new Map();
  for (const violation of violations) {
    const name = violation.rule.name;
    const list = byRule.get(name) ?? [];
    list.push(violation);
    byRule.set(name, list);
  }

  for (const name of EXPECTED_RULES) {
    const found = byRule.get(name) ?? [];
    assert.equal(
      found.length,
      1,
      `${name} found ${String(found.length)}: ${found
        .map((item) => `${item.from} -> ${item.to}`)
        .join('; ')}`
    );
  }
  for (const name of byRule.keys()) {
    assert.equal(
      EXPECTED_RULES.includes(name),
      true,
      `unexpected rule ${name}`
    );
  }

  const domain = byRule.get('layer-infrastructure-to-domain')?.[0];
  assert.match(domain.from, /type-only\.ts$/);
  const subpath = byRule.get('layer-root-to-subpath')?.[0];
  assert.match(subpath.to, /\/src\/server\//);
  const host = byRule.get('isomorphic-host')?.[0];
  assert.match(host.from, /domain-math\/src\/node\.ts$/);
  const relative = byRule.get('no-cross-package-relative')?.[0];
  assert.match(relative.from, /tests\/relative\.ts$/);

  const clean = [
    'domain-math/src/index.ts',
    'domain-ecs/src/index.ts',
    'application-runtime/src/ok.ts',
    'application-runtime/src/server/index.ts',
    'application-runtime/src/server/node.ts',
    'infra-client/src/ok.ts',
    'composition-game/src/ok.ts',
    'app-playground/src/index.ts',
  ];
  for (const suffix of clean) {
    const hit = violations.find((violation) => violation.from.endsWith(suffix));
    assert.equal(hit, undefined, `${suffix} violated ${hit?.rule.name}`);
  }
});
