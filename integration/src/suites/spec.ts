import type { MatchSpec } from '../driver/SimDriver.js';

export function demoSpec(seed: number, armySize = 0): MatchSpec {
  return {
    seed: seed >>> 0,
    inputDelayTicks: 1,
    slots: [
      { kind: 'human', team: 0 },
      { kind: 'bot', team: 1, policy: 'aggressive', level: 1 },
    ],
    options: armySize > 0 ? { armySize } : {},
  };
}
