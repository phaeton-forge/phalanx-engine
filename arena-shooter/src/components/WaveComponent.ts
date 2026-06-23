import type { IComponent } from '@phalanx-engine/ecs';
import { ComponentType } from './ComponentType.ts';
import { TOTAL_WAVES } from '../config/constants.ts';

export type GameState = 'LOADING' | 'PLAYING' | 'WAVE_CLEAR_PAUSE' | 'GAME_OVER' | 'VICTORY';

export class WaveComponent implements IComponent {
  public readonly type = ComponentType.Wave;

  public currentWave: number = 0;
  public totalWaves: number = TOTAL_WAVES;
  public enemiesAlive: number = 0;
  public state: GameState = 'LOADING';
  public waveTimer: number = 0;
}
