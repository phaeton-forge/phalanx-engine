import { Entity, type EntityManager } from '@phalanx-engine/ecs';
import { FP, FPVector3, type FixedPoint } from '@phalanx-engine/math';
import { PhysicsBodyComponent } from '@phalanx-engine/physics';
import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  type Scene,
  type Mesh,
  Animation,
  ParticleSystem,
  Vector3,
  PointLight,
} from '@babylonjs/core';
import { TransformComponent } from '../components/TransformComponent.ts';
import { InterpolationComponent } from '../components/InterpolationComponent.ts';
import { PlayerInputComponent } from '../components/PlayerInputComponent.ts';
import { WeaponComponent } from '../components/WeaponComponent.ts';
import { HealthComponent } from '../components/HealthComponent.ts';
import { EnemyAIComponent } from '../components/EnemyAIComponent.ts';
import { ProjectileComponent } from '../components/ProjectileComponent.ts';
import { PickupComponent } from '../components/PickupComponent.ts';
import { EntityTypeComponent } from '../components/EntityTypeComponent.ts';
import {
  PLAYER_RADIUS,
  PLAYER_MAX_HP,
  ENEMY_RADIUS,
  PROJECTILE_RADIUS,
  PROJECTILE_SPEED,
  PROJECTILE_LIFETIME_TICKS,
  PICKUP_HEAL_AMOUNT,
  PICKUP_LIFETIME_TICKS,
  PICKUP_RADIUS,
} from '../config/constants.ts';
import { vfxConfig } from '../config/vfxConfig.ts';
import { ProjectileTrail } from '../effects/ProjectileTrail.ts';

export class EntityFactory {
  private scene: Scene;
  private entityManager: EntityManager;
  private meshMap: Map<number, Mesh>;
  private particleSystems: Map<number, ParticleSystem[]> = new Map();
  private projectileTrails: Map<number, ProjectileTrail> = new Map();
  public playerLight: PointLight | null = null;

  constructor(scene: Scene, entityManager: EntityManager, meshMap: Map<number, Mesh>) {
    this.scene = scene;
    this.entityManager = entityManager;
    this.meshMap = meshMap;
  }

  public createPlayer(): number {
    const entity = new Entity();
    const fpPos = FPVector3.FromFloat(0, 0, 0);

    entity.addComponent(new TransformComponent(entity.id, fpPos));
    entity.addComponent(new InterpolationComponent(fpPos));
    entity.addComponent(new PlayerInputComponent());
    entity.addComponent(new WeaponComponent());
    entity.addComponent(new HealthComponent(PLAYER_MAX_HP, PLAYER_MAX_HP));
    entity.addComponent(new EntityTypeComponent('player'));
    entity.addComponent(new PhysicsBodyComponent(entity.id, {
      radius: PLAYER_RADIUS,
      mass: FP._1,
      isStatic: false,
      // No friction — velocity is explicitly set each tick by PlayerMovementSystem
    }));

    this.entityManager.addEntity(entity);

    const mesh = this.createPlayerMesh(entity.id);
    this.meshMap.set(entity.id, mesh);

    // Player point light
    this.playerLight = new PointLight(`player_light_${entity.id}`, new Vector3(0, 2, 0), this.scene);
    this.playerLight.intensity = 0.5;
    this.playerLight.range = 8;
    this.playerLight.diffuse = new Color3(0, 0.267, 1); // #0044FF

    return entity.id;
  }

  public createEnemy(fpX: FixedPoint, fpZ: FixedPoint, speed: FixedPoint, targetEntityId: number): number {
    const entity = new Entity();
    const fpPos = FPVector3.Create(fpX, FP._0, fpZ);

    entity.addComponent(new TransformComponent(entity.id, fpPos));
    entity.addComponent(new InterpolationComponent(fpPos));
    entity.addComponent(new EnemyAIComponent(targetEntityId, speed));
    entity.addComponent(new HealthComponent(1, 1));
    entity.addComponent(new EntityTypeComponent('enemy'));
    entity.addComponent(new PhysicsBodyComponent(entity.id, {
      radius: ENEMY_RADIUS,
      mass: FP._1,
      isStatic: false,
    }));

    this.entityManager.addEntity(entity);

    const mesh = this.createEnemyMesh(entity.id);
    this.meshMap.set(entity.id, mesh);

    return entity.id;
  }

  public createProjectile(fpX: FixedPoint, fpZ: FixedPoint, dirX: FixedPoint, dirZ: FixedPoint, ownerId: number): number {
    const entity = new Entity();
    const fpPos = FPVector3.Create(fpX, FP.FromFloat(0.9), fpZ);

    const transform = new TransformComponent(entity.id, fpPos);
    entity.addComponent(transform);
    entity.addComponent(new InterpolationComponent(fpPos));
    entity.addComponent(new ProjectileComponent(
      PROJECTILE_LIFETIME_TICKS,
      ownerId,
      dirX,
      dirZ,
      PROJECTILE_SPEED,
    ));
    entity.addComponent(new EntityTypeComponent('projectile'));
    entity.addComponent(new PhysicsBodyComponent(entity.id, {
      radius: PROJECTILE_RADIUS,
      mass: FP._0,
      isStatic: false,
    }));

    this.entityManager.addEntity(entity);

    // Set rotation to face movement direction
    const angle = FP.Atan2(dirX, dirZ);
    transform.fpRotationY = angle;

    const mesh = this.createProjectileMesh(entity.id, dirX, dirZ);
    // Set mesh position to spawn point BEFORE creating trails
    mesh.position.x = FP.ToFloat(fpX);
    mesh.position.z = FP.ToFloat(fpZ);
    // Force world matrix update so TrailMesh reads the correct position
    mesh.computeWorldMatrix(true);
    this.meshMap.set(entity.id, mesh);

    // Projectile trail particle
    this.createProjectileTrail(entity.id, mesh);

    // TrailMesh visual trail
    if (vfxConfig.enabled) {
      const trail = new ProjectileTrail(this.scene, mesh);
      trail.start();
      this.projectileTrails.set(entity.id, trail);
    }

    return entity.id;
  }

  public createPickup(fpX: FixedPoint, fpZ: FixedPoint): number {
    const entity = new Entity();
    const fpPos = FPVector3.Create(fpX, FP.FromFloat(0.3), fpZ);

    entity.addComponent(new TransformComponent(entity.id, fpPos));
    entity.addComponent(new InterpolationComponent(fpPos, true));
    entity.addComponent(new PickupComponent(PICKUP_HEAL_AMOUNT, PICKUP_LIFETIME_TICKS));
    entity.addComponent(new EntityTypeComponent('pickup'));
    entity.addComponent(new PhysicsBodyComponent(entity.id, {
      radius: PICKUP_RADIUS,
      mass: FP._0,
      isStatic: true,
    }));

    this.entityManager.addEntity(entity);

    const mesh = this.createPickupMesh(entity.id);
    this.meshMap.set(entity.id, mesh);

    return entity.id;
  }

  // --- TRON-style mesh creation ---

  private createPlayerMesh(entityId: number): Mesh {
    const capsule = MeshBuilder.CreateCapsule(`player_${entityId}`, {
      height: 1.8,
      radius: 0.4,
    }, this.scene);

    const mat = new StandardMaterial(`player_mat_${entityId}`, this.scene);
    mat.diffuseColor = new Color3(
      vfxConfig.colors.player.diffuse.r,
      vfxConfig.colors.player.diffuse.g,
      vfxConfig.colors.player.diffuse.b,
    );
    mat.emissiveColor = new Color3(
      vfxConfig.colors.player.emissive.r,
      vfxConfig.colors.player.emissive.g,
      vfxConfig.colors.player.emissive.b,
    );
    mat.specularColor = new Color3(0, 0.749, 1);
    mat.disableLighting = false;
    capsule.material = mat;
    capsule.metadata = { team: 'player' };
    capsule.position.y = 0.9;

    // Weapon barrel with emissive glow
    const stick = MeshBuilder.CreateCylinder(`player_stick_${entityId}`, {
      height: 0.8,
      diameter: 0.12,
    }, this.scene);
    const stickMat = new StandardMaterial(`stick_mat_${entityId}`, this.scene);
    stickMat.diffuseColor = new Color3(0.1, 0, 0);
    stickMat.emissiveColor = new Color3(1, 0.4, 0); // Orange
    stickMat.disableLighting = true;
    stick.material = stickMat;
    stick.rotation.x = Math.PI / 2;
    stick.position.z = 0.5;
    stick.position.y = 0;
    stick.parent = capsule;

    return capsule;
  }

  private createEnemyMesh(entityId: number): Mesh {
    const sphere = MeshBuilder.CreateSphere(`enemy_${entityId}`, {
      diameter: 1.0,
    }, this.scene);
    const mat = new StandardMaterial(`enemy_mat_${entityId}`, this.scene);
    mat.diffuseColor = new Color3(
      vfxConfig.colors.enemy.diffuse.r,
      vfxConfig.colors.enemy.diffuse.g,
      vfxConfig.colors.enemy.diffuse.b,
    );
    mat.emissiveColor = new Color3(
      vfxConfig.colors.enemy.emissive.r,
      vfxConfig.colors.enemy.emissive.g,
      vfxConfig.colors.enemy.emissive.b,
    );
    mat.disableLighting = false;
    sphere.material = mat;
    sphere.metadata = { team: 'enemy' };
    sphere.position.y = 0.5;

    // Pulsing emissive animation
    const pulseAnim = new Animation(
      `enemy_pulse_${entityId}`,
      'material.emissiveColor.r',
      20,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE,
    );
    pulseAnim.setKeys([
      { frame: 0, value: 0.7 },
      { frame: 10, value: 1.0 },
      { frame: 20, value: 0.7 },
    ]);
    sphere.animations.push(pulseAnim);
    this.scene.beginAnimation(sphere, 0, 20, true);

    return sphere;
  }

  private createProjectileMesh(entityId: number, dirX: FixedPoint, dirZ: FixedPoint): Mesh {
    const sphere = MeshBuilder.CreateSphere(`projectile_${entityId}`, {
      diameter: 0.3,
    }, this.scene);
    const mat = new StandardMaterial(`projectile_mat_${entityId}`, this.scene);
    mat.diffuseColor = new Color3(
      vfxConfig.colors.projectile.diffuse.r,
      vfxConfig.colors.projectile.diffuse.g,
      vfxConfig.colors.projectile.diffuse.b,
    );
    mat.emissiveColor = new Color3(
      vfxConfig.colors.projectile.emissive.r,
      vfxConfig.colors.projectile.emissive.g,
      vfxConfig.colors.projectile.emissive.b,
    );
    mat.disableLighting = true;
    sphere.material = mat;
    sphere.metadata = { isProjectile: true };
    sphere.position.y = 0.9;
    // Elongate in flight direction
    sphere.scaling.z = 3;

    // Rotate to face direction
    const angle = Math.atan2(FP.ToFloat(dirX), FP.ToFloat(dirZ));
    sphere.rotation.y = angle;

    return sphere;
  }

  private createPickupMesh(entityId: number): Mesh {
    const box = MeshBuilder.CreateBox(`pickup_${entityId}`, {
      width: 0.4,
      height: 0.4,
      depth: 0.4,
    }, this.scene);
    const mat = new StandardMaterial(`pickup_mat_${entityId}`, this.scene);
    mat.diffuseColor = new Color3(0, 0.102, 0.039); // #001A0A
    mat.emissiveColor = new Color3(0, 1, 0.4); // #00FF66
    mat.disableLighting = true;
    box.material = mat;
    box.position.y = 0.3;

    // Tilt 45 degrees on each axis
    box.rotation.x = Math.PI / 4;
    box.rotation.z = Math.PI / 4;

    // Slow rotation around vertical axis
    const spinAnim = new Animation(
      `pickup_spin_${entityId}`,
      'rotation.y',
      20,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE,
    );
    spinAnim.setKeys([
      { frame: 0, value: 0 },
      { frame: 60, value: Math.PI * 2 },
    ]);
    box.animations.push(spinAnim);

    // Bobbing animation
    const bobAnim = new Animation(
      `pickup_bob_${entityId}`,
      'position.y',
      20,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE,
    );
    bobAnim.setKeys([
      { frame: 0, value: 0.3 },
      { frame: 30, value: 0.45 },
      { frame: 60, value: 0.3 },
    ]);
    box.animations.push(bobAnim);

    // Emissive pulse animation
    const emissiveAnim = new Animation(
      `pickup_emissive_${entityId}`,
      'material.emissiveColor.g',
      20,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CYCLE,
    );
    emissiveAnim.setKeys([
      { frame: 0, value: 1.0 },
      { frame: 30, value: 0.5 },
      { frame: 60, value: 1.0 },
    ]);
    box.animations.push(emissiveAnim);

    this.scene.beginAnimation(box, 0, 60, true);

    return box;
  }

  // --- Particle systems ---

  private createProjectileTrail(entityId: number, mesh: Mesh): void {
    const ps = new ParticleSystem(`trail_${entityId}`, 20, this.scene);
    ps.emitter = mesh;
    ps.minSize = 0.05;
    ps.maxSize = 0.12;
    ps.minLifeTime = 0.08;
    ps.maxLifeTime = 0.12;
    ps.emitRate = 60;
    ps.color1 = new Color4(0, 1, 1, 1);
    ps.color2 = new Color4(0, 0.5, 1, 0.5);
    ps.colorDead = new Color4(0, 0, 0.2, 0);
    ps.minEmitPower = 0.1;
    ps.maxEmitPower = 0.3;
    ps.updateSpeed = 0.01;
    ps.createSphereEmitter(0.05);
    ps.start();

    const existing = this.particleSystems.get(entityId) ?? [];
    existing.push(ps);
    this.particleSystems.set(entityId, existing);
  }

  public createExplosion(x: number, z: number): void {
    const ps = new ParticleSystem('explosion', 40, this.scene);
    ps.emitter = new Vector3(x, 0.5, z);
    ps.minSize = 0.1;
    ps.maxSize = 0.4;
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.5;
    ps.emitRate = 0; // burst mode
    ps.color1 = new Color4(1, 0.3, 0, 1);
    ps.color2 = new Color4(1, 0.1, 0, 1);
    ps.colorDead = new Color4(0.3, 0, 0, 0);
    ps.minEmitPower = 2;
    ps.maxEmitPower = 5;
    ps.updateSpeed = 0.01;
    ps.createSphereEmitter(1.5);
    ps.manualEmitCount = 40;
    ps.targetStopDuration = 0.5;
    ps.disposeOnStop = true;
    ps.start();
  }

  public createMuzzleFlash(x: number, z: number): void {
    const ps = new ParticleSystem('muzzle', 15, this.scene);
    ps.emitter = new Vector3(x, 0.9, z);
    ps.minSize = 0.05;
    ps.maxSize = 0.15;
    ps.minLifeTime = 0.04;
    ps.maxLifeTime = 0.08;
    ps.emitRate = 0;
    ps.color1 = new Color4(1, 1, 1, 1);
    ps.color2 = new Color4(0, 1, 1, 1);
    ps.colorDead = new Color4(0, 0, 0, 0);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 3;
    ps.updateSpeed = 0.005;
    ps.createSphereEmitter(0.1);
    ps.manualEmitCount = 15;
    ps.targetStopDuration = 0.08;
    ps.disposeOnStop = true;
    ps.start();
  }

  public getMesh(entityId: number): Mesh | undefined {
    return this.meshMap.get(entityId);
  }

  public disposeParticles(entityId: number): void {
    const systems = this.particleSystems.get(entityId);
    if (systems) {
      for (const ps of systems) {
        ps.dispose();
      }
      this.particleSystems.delete(entityId);
    }
    const trail = this.projectileTrails.get(entityId);
    if (trail) {
      trail.dispose();
      this.projectileTrails.delete(entityId);
    }
  }
}
