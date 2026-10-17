import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Scenario } from '../dsl/scenario.js';

/** Write a scenario where the suite will pick it up on the next run. */
export function promoteScenario(scenario: Scenario, directory: string): string {
  mkdirSync(directory, { recursive: true });
  const safe = scenario.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const path = join(directory, `${safe === '' ? 'case' : safe}.json`);
  writeFileSync(path, `${JSON.stringify(scenario, null, 2)}\n`, 'utf8');
  return path;
}
