import { GameSystem, type SystemContext } from '@phalanx-engine/ecs';
import { Color3, Vector3, type Scene } from '@babylonjs/core';
import { ParticlePool } from '../effects/ParticlePool.ts';
import { DeathEffect } from '../effects/DeathEffect.ts';
import { HitEffect } from '../effects/HitEffect.ts';
import { AmbientParticles } from '../effects/AmbientParticles.ts';
import { vfxConfig } from '../config/vfxConfig.ts';
import { ARENA_SIZE } from '../config/constants.ts';
import {
  GameEvents,
  type EnemyKilledEvent,
  type ScreenShakeEvent,
  type PlayerDamagedEvent,
} from '../events/GameEvents.ts';

export class VFXSystem extends GameSystem {
  private pool!: ParticlePool;
  private deathEffect!: DeathEffect;
  private hitEffect!: HitEffect;
  private ambient!: AmbientParticles;
  private scene: Scene;

  private readonly enemyColor = new Color3(
    vfxConfig.colors.enemy.diffuse.r,
    vfxConfig.colors.enemy.diffuse.g,
    vfxConfig.colors.enemy.diffuse.b,
  );
  private readonly playerColor = new Color3(
    vfxConfig.colors.player.diffuse.r,
    vfxConfig.colors.player.diffuse.g,
    vfxConfig.colors.player.diffuse.b,
  );

  constructor(scene: Scene) {
    super();
    this.scene = scene;
  }

  public override init(context: SystemContext): void {
    super.init(context);

    if (!vfxConfig.enabled) return;

    this.pool = new ParticlePool(this.scene);
    this.deathEffect = new DeathEffect(this.scene, this.pool);
    this.hitEffect = new HitEffect(this.scene, this.pool);
    this.ambient = new AmbientParticles(this.scene, ARENA_SIZE, ARENA_SIZE);

    // Enemy killed → death explosion + hit sparks + screen shake
    // EnemyKilledEvent already contains positionX/positionZ (captured before entity is destroyed)
    this.subscribe<EnemyKilledEvent>(GameEvents.COMBAT_ENEMY_KILLED, (event) => {
      const pos = new Vector3(event.positionX, 0.5, event.positionZ);

      // Death explosion with enemy color
      this.deathEffect.spawn(pos, this.enemyColor);

      // Hit sparks with player projectile color (player shot killed the enemy)
      this.hitEffect.spawn(pos, this.playerColor);

      // Screen shake — kill intensity
      this.eventBus.emit<ScreenShakeEvent>(GameEvents.SCREEN_SHAKE, {
        intensity: vfxConfig.screenShake.killIntensity,
      });
    });

    // Player damaged → light screen shake
    this.subscribe<PlayerDamagedEvent>(GameEvents.COMBAT_PLAYER_DAMAGED, (_event) => {
      this.eventBus.emit<ScreenShakeEvent>(GameEvents.SCREEN_SHAKE, {
        intensity: vfxConfig.screenShake.hitIntensity,
      });
    });

    // Start ambient particles immediately
    this.ambient.start();
  }

  public override dispose(): void {
    this.ambient?.dispose();
    this.pool?.dispose();
    super.dispose();
  }
}
