export const GameEvents = {
  COMBAT_ENEMY_KILLED: 'combat:enemyKilled',
  COMBAT_PLAYER_DAMAGED: 'combat:playerDamaged',
  HEALTH_DIED: 'health:died',
  GAME_WAVE_COMPLETE: 'game:waveComplete',
  GAME_VICTORY: 'game:victory',
  GAME_GAME_OVER: 'game:gameOver',
  WEAPON_FIRED: 'weapon:fired',
  WEAPON_RELOAD_START: 'weapon:reloadStart',
  WEAPON_RELOAD_COMPLETE: 'weapon:reloadComplete',
  SCREEN_SHAKE: 'screen_shake',
} as const;

export interface EnemyKilledEvent {
  enemyId: number;
  positionX: number;
  positionZ: number;
}

export interface PlayerDamagedEvent {
  damage: number;
  currentHp: number;
}

export interface HealthDiedEvent {
  entityId: number;
}

export interface WaveCompleteEvent {
  wave: number;
}

export interface WeaponFiredEvent {
  originX: number;
  originZ: number;
  dirX: number;
  dirZ: number;
}

export interface ScreenShakeEvent {
  intensity: number;
}
