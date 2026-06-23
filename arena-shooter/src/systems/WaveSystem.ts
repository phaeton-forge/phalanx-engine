import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { ComponentType } from '../components/ComponentType.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';
import type { WaveComponent } from '../components/WaveComponent.ts';
import { GameRandom } from '../core/GameRandom.ts';
import type { EntityFactory } from '../core/EntityFactory.ts';
import { GameEvents, type EnemyKilledEvent, type WaveCompleteEvent } from '../events/GameEvents.ts';
import {
  ARENA_SIZE,
  WAVE_ENEMIES_BASE,
  WAVE_ENEMIES_PER_WAVE,
  WAVE_PAUSE_TICKS,
  ENEMY_BASE_SPEED,
  ENEMY_SPEED_INCREMENT,
  ENEMY_MIN_SPAWN_DISTANCE,
} from '../config/constants.ts';

export class WaveSystem extends GameSystem {
  private entityFactory: EntityFactory;
  private playerId: number = -1;

  constructor(entityFactory: EntityFactory) {
    super();
    this.entityFactory = entityFactory;
  }

  public setPlayerId(id: number): void {
    this.playerId = id;
  }

  public override init(context: SystemContext): void {
    super.init(context);

    this.subscribe<EnemyKilledEvent>(GameEvents.COMBAT_ENEMY_KILLED, () => {
      const waveEntities = this.entityManager.queryEntities(ComponentType.Wave);
      if (waveEntities.length === 0) return;
      const wave = waveEntities[0].getComponent<WaveComponent>(ComponentType.Wave);
      if (wave) {
        wave.enemiesAlive = Math.max(0, wave.enemiesAlive - 1);
      }
    });
  }

  public override processTick(_tick: number): void {
    const waveEntities = this.entityManager.queryEntities(ComponentType.Wave);
    if (waveEntities.length === 0) return;
    const wave = waveEntities[0].getComponent<WaveComponent>(ComponentType.Wave);
    if (!wave) return;

    switch (wave.state) {
      case 'LOADING':
        wave.waveTimer--;
        if (wave.waveTimer <= 0) {
          wave.state = 'PLAYING';
          this.spawnWave(wave);
        }
        break;

      case 'PLAYING':
        if (wave.enemiesAlive <= 0 && wave.currentWave > 0) {
          if (wave.currentWave >= wave.totalWaves) {
            wave.state = 'VICTORY';
            this.eventBus.emit(GameEvents.GAME_VICTORY, {});
          } else {
            wave.state = 'WAVE_CLEAR_PAUSE';
            wave.waveTimer = WAVE_PAUSE_TICKS;
            this.eventBus.emit<WaveCompleteEvent>(GameEvents.GAME_WAVE_COMPLETE, {
              wave: wave.currentWave,
            });
          }
        }
        break;

      case 'WAVE_CLEAR_PAUSE':
        wave.waveTimer--;
        if (wave.waveTimer <= 0) {
          wave.state = 'PLAYING';
          this.spawnWave(wave);
        }
        break;

      case 'GAME_OVER':
      case 'VICTORY':
        // Do nothing
        break;
    }
  }

  private spawnWave(wave: WaveComponent): void {
    wave.currentWave++;
    const enemyCount = WAVE_ENEMIES_BASE + wave.currentWave * WAVE_ENEMIES_PER_WAVE;
    wave.enemiesAlive = enemyCount;

    const speed = FP.Add(ENEMY_BASE_SPEED, FP.Mul(ENEMY_SPEED_INCREMENT, FP.FromFloat(wave.currentWave - 1)));
    const halfArena = ARENA_SIZE / 2;
    const minDistSq = FP.Mul(ENEMY_MIN_SPAWN_DISTANCE, ENEMY_MIN_SPAWN_DISTANCE);

    // Get player position for distance check
    const playerEntity = this.playerId >= 0 ? this.entityManager.getEntity(this.playerId) : null;
    const playerTransform = playerEntity?.getComponent<TransformComponent>(ComponentType.Transform);
    const playerFpX = playerTransform ? playerTransform.fpPosition.x : FP._0;
    const playerFpZ = playerTransform ? playerTransform.fpPosition.z : FP._0;

    for (let i = 0; i < enemyCount; i++) {
      let x: number;
      let z: number;

      // Spawn on perimeter, away from player
      do {
        const side = GameRandom.intRange(0, 3);
        switch (side) {
          case 0: // North
            x = GameRandom.floatRange(-halfArena + 1, halfArena - 1);
            z = -halfArena + 1;
            break;
          case 1: // South
            x = GameRandom.floatRange(-halfArena + 1, halfArena - 1);
            z = halfArena - 1;
            break;
          case 2: // West
            x = -halfArena + 1;
            z = GameRandom.floatRange(-halfArena + 1, halfArena - 1);
            break;
          default: // East
            x = halfArena - 1;
            z = GameRandom.floatRange(-halfArena + 1, halfArena - 1);
            break;
        }
        const dx = FP.Sub(FP.FromFloat(x), playerFpX);
        const dz = FP.Sub(FP.FromFloat(z), playerFpZ);
        const distSq = FP.Add(FP.Mul(dx, dx), FP.Mul(dz, dz));
        if (FP.Gte(distSq, minDistSq)) break;
      } while (true);

      this.entityFactory.createEnemy(FP.FromFloat(x), FP.FromFloat(z), speed, this.playerId);
    }
  }
}
