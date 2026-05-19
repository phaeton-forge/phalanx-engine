export type CuePhase = 'OnApplied' | 'OnPeriodic' | 'OnExpired';

export interface CueEvent {
  tick: number;
  cueId: string;
  sourceEntityId: number;
  targetEntityId: number;
  phase: CuePhase;
}
