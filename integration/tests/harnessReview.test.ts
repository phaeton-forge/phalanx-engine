import { describe, expect, it } from 'vitest';
import { createV65Driver } from '../src/adapters/v65.js';
import { simulate } from '../src/dsl/interpret.js';
import { catalog } from '../src/suites/catalog.js';
import type { Scenario } from '../src/dsl/scenario.js';

function named(name: string): Scenario {
  const found = catalog().find((item) => item.name === name);
  if (found === undefined) throw new Error(`missing scenario ${name}`);
  return found;
}

describe('copilot harness regressions', () => {
  it('steps a pending handoff across fromTick without the log command', async () => {
    const driver = createV65Driver();
    const result = await simulate(
      driver,
      named('controller-handoff-restore-before')
    );
    expect(result.ticks).toBe(8);
    const becameBot = result.controller?.some((row) =>
      row.slots.some((slot) => slot.slot === 0 && slot.mode === 'bot')
    );
    expect(becameBot).toBe(true);
  });

  it('compares rejections after a lagged replica catches up', async () => {
    const driver = createV65Driver();
    const item = named('controller-rejection-after-lag');
    const result = await simulate(driver, item);
    expect(result.ticks).toBe(item.ticks);
  });

  it('defers a malformed inject that sits outside the replica window', async () => {
    const driver = createV65Driver();
    const item = named('malformed-behind-window');
    const result = await simulate(driver, item);
    expect(result.ticks).toBe(item.ticks);
  });

  it('does not re-arm a handoff already stored in a round-tripped snapshot', async () => {
    const driver = createV65Driver();
    const item = named('controller-handoff-roundtrip');
    const result = await simulate(driver, item);
    expect(result.ticks).toBe(item.ticks);
    const becameBot = result.controller?.some((row) =>
      row.slots.some((slot) => slot.slot === 0 && slot.mode === 'bot')
    );
    expect(becameBot).toBe(true);
  });
});
