import type { AbilitySystemFacade } from 'phalanx-abilities';
import type { TeamId } from '../components';

export interface GameRuntimeState {
  currentTick: number;
  simulationStarted: boolean;
  gameOver: boolean;
  winnerTeam: TeamId | null;
  localTeam: TeamId;
  beamPulseTime: number;
}

export interface AbilityContext {
  facade: AbilitySystemFacade;
  effects: {
    damage18: string;
    damage54: string;
    heal5: string;
    illuminated: string;
    jammed: string;
    cubeAuraLifetime: string;
  };
  tags: {
    team1: string;
    team2: string;
    illuminated: string;
    cubeAura: string;
  };
  attributeIndexes: {
    health: number;
    moveSpeedMultiplier: number;
    attackSpeedMultiplier: number;
  };
}
