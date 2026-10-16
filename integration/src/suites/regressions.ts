import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenario, type Scenario } from '../dsl/scenario.js';
import { parseJson } from '../util/json.js';

export function loadRegressions(directory: string): Scenario[] {
  let names: string[] = [];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const scenarios: Scenario[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const raw = parseJson(readFileSync(join(directory, name), 'utf8'));
    scenarios.push(parseScenario(raw));
  }
  return scenarios;
}
