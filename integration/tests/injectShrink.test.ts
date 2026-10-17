import { describe, expect, it } from 'vitest';
import { createCurrentDriver } from '../src/adapters/current.js';
import { simulate } from '../src/dsl/interpret.js';
import { injectScenario } from '../src/fuzz/generate.js';
import { shrinkScenario } from '../src/fuzz/shrink.js';
import { errorMessage } from '../src/util/json.js';

describe('injectDesync fuzz', () => {
  it('finds the desync and shrinks it to at most five events', async () => {
    const driver = createCurrentDriver();
    const scenario = injectScenario(11);
    expect(scenario.timeline.length).toBeGreaterThanOrEqual(15);
    expect(scenario.timeline.length).toBeLessThanOrEqual(20);
    await expect(simulate(driver, scenario)).rejects.toThrow(/diverged/);
    const shrunk = await shrinkScenario(scenario, async (candidate) => {
      try {
        await simulate(driver, candidate);
        return false;
      } catch (error) {
        return errorMessage(error).includes('diverged');
      }
    });
    expect(shrunk.timeline.length).toBeLessThanOrEqual(5);
    expect(shrunk.timeline.some((event) => event.op === 'inject')).toBe(true);
    await expect(simulate(driver, shrunk)).rejects.toThrow(/diverged/);
  }, 180_000);
});
