import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/dsl/scenario.js';
import { catalog } from '../src/suites/catalog.js';
import { parseJson } from '../src/util/json.js';

describe('scenario json', () => {
  it('round-trips the catalog', () => {
    for (const item of catalog()) {
      const parsed = parseScenario(parseJson(JSON.stringify(item)));
      expect(parsed).toEqual(item);
    }
  });
});
