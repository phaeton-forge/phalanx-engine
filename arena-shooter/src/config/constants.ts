import { FP } from '@phalanx-engine/math';

export const ARENA_SIZE = 50;
export const TICK_RATE = 30;
export const RANDOM_SEED = 12345;

export const PLAYER_SPEED = FP.FromFloat(8);
export const PLAYER_MAX_HP = 100;
export const PLAYER_RADIUS = FP.FromFloat(0.4);
export const PLAYER_SPAWN_X = FP._0;
export const PLAYER_SPAWN_Z = FP._0;

export const ENEMY_BASE_SPEED = FP.FromFloat(4);
export const ENEMY_SPEED_INCREMENT = FP.FromFloat(0.3);
export const ENEMY_RADIUS = FP.FromFloat(0.5);
export const ENEMY_CONTACT_DAMAGE = 15;
export const ENEMY_DROP_CHANCE = 0.25;

export const PROJECTILE_SPEED = FP.FromFloat(22);
export const PROJECTILE_RADIUS = FP.FromFloat(0.15);
export const PROJECTILE_LIFETIME_TICKS = 45;

export const WEAPON_MAX_AMMO = 8;
export const WEAPON_RELOAD_TICKS = 60;

export const PICKUP_HEAL_AMOUNT = 25;
export const PICKUP_RADIUS = FP.FromFloat(0.8);
export const PICKUP_LIFETIME_TICKS = 360;

export const TOTAL_WAVES = 10;
export const WAVE_ENEMIES_BASE = 3;
export const WAVE_ENEMIES_PER_WAVE = 2;
export const WAVE_PAUSE_TICKS = 90;
export const WAVE_INTRO_DELAY_TICKS = 60;
export const ENEMY_MIN_SPAWN_DISTANCE = FP.FromFloat(8);
