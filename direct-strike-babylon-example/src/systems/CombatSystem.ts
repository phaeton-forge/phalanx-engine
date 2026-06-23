import { Vector3 } from '@babylonjs/core';
import type { Unit } from '../entities/Unit';
import { Tower } from '../entities/Tower';
import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import { GameRandom } from '../core/GameRandom';
import { MovementSystem } from './MovementSystem';
import {
  AnimationComponent,
  AttackComponent,
  AttackLockComponent,
  ComponentType,
  DeathComponent,
  HealthComponent,
  MovementComponent,
  RotationComponent,
  TeamComponent,
  TransformComponent,
} from '../components';
import type {
  DamageAppliedEvent,
  DamageRequestedEvent,
  ProjectileSpawnedEvent,
  OrientToTargetEvent,
  NotifyMovementStartedEvent,
  EndCombatEvent,
  OrientToMovementDirectionEvent,
  PlayAttackAnimationEvent,
} from '../events';
import { createEvent, GameEvents } from '../events';
import { networkConfig } from '../config/constants';
import {
  FP,
  FPVector3,
  type FixedPoint,
} from '@phalanx-engine/math';

/**
 * Combat system configuration for deterministic simulation
 */
export interface CombatConfig {
  fixedTimestep: number; // Fixed delta time for deterministic updates (e.g., 1/60)
  criticalHitChance: number; // Probability of critical hit (0-1)
  criticalHitMultiplier: number; // Damage multiplier on critical hit
}

// Pre-computed fixed-point constants for combat distance calculations
// Using squared distances avoids expensive sqrt operations
// Note: Using FromString for very small numbers to avoid BigInt conversion issues with scientific notation
const FP_DISTANCE_EPSILON_SQ = FP.FromString('0.00001'); // Small epsilon for tie-breaking comparison

const DEFAULT_COMBAT_CONFIG: CombatConfig = {
  // Combat updates once per network tick for deterministic lockstep
  fixedTimestep: networkConfig.tickTimestep,
  // Critical hit settings (using GameRandom for determinism)
  criticalHitChance: 0.1, // 10% base crit chance
  criticalHitMultiplier: 1.5, // 50% bonus damage on crit
};

/**
 * CombatSystem - Handles attack range detection and combat logic
 * Uses component-based entity queries
 * Uses EventBus for decoupled communication (projectile spawning, animations)
 * Extends GameSystem for consistent lifecycle management
 *
 * IMPORTANT: Uses fixed timestep for deterministic attack cooldown updates.
 * This ensures combat outcomes are identical across all clients.
 *
 * Combat behavior:
 * - When an enemy is in range, the unit stops moving and attacks
 * - When damaged, unit moves to engage attacker if not already in range
 * - When the enemy is killed, the unit resumes moving to its original target
 *
 * LOCKSTEP SYNCHRONIZATION:
 * Combat-initiated movement (chasing targets, resuming after combat) calls
 * MovementSystem.moveEntityTo() directly. These are deterministic simulation
 * decisions that all clients compute identically during tick processing.
 */
export class CombatSystem extends GameSystem {
  private config: CombatConfig;
  private currentTargets: Map<number, number> = new Map(); // attacker ID -> target ID
  private storedMoveTargets: Map<number, Vector3> = new Map(); // attacker ID -> original move target
  private aggroTargets: Map<number, number> = new Map(); // entity ID -> attacker ID (who damaged them)
  private movementSystem!: MovementSystem;

  constructor(config?: Partial<CombatConfig>) {
    super();
    this.config = { ...DEFAULT_COMBAT_CONFIG, ...config };
  }

  /**
   * Initialize the system - set up event listeners
   */
  public override init(context: SystemContext): void {
    super.init(context);

    // Resolve MovementSystem for direct moveEntityTo calls during tick processing.
    // Combat-initiated moves are deterministic simulation decisions — they must
    // execute immediately in the same tick, not go through the network.
    const ms = context.getSystem(MovementSystem);
    if (!ms) throw new Error('CombatSystem requires MovementSystem to be registered first');
    this.movementSystem = ms;

    // Listen for damage events to track who attacked whom
    this.subscribe<DamageAppliedEvent>(
      GameEvents.DAMAGE_APPLIED,
      (event) => {
        if (event.sourceId !== undefined) {
          this.handleDamageReceived(event.entityId, event.sourceId);
        }
      }
    );
  }

  /**
   * Handle when an entity receives damage - set aggro on the attacker
   */
  private handleDamageReceived(targetId: number, attackerId: number): void {
    const target = this.entityManager.getEntity(targetId);
    const attacker = this.entityManager.getEntity(attackerId);

    if (!target || !attacker) return;

    // Only mobile units can retaliate
    const movement = target.getComponent<MovementComponent>(
      ComponentType.Movement
    );
    if (!movement) return;

    // Check if the target can attack (has attack component)
    const attack = target.getComponent<AttackComponent>(ComponentType.Attack);
    if (!attack) return;

    // Check if attacker is still alive
    const attackerHealth = attacker.getComponent<HealthComponent>(
      ComponentType.Health
    );
    if (attackerHealth?.isDestroyed) return;

    // Set aggro target - this unit will prioritize attacking who hit them
    this.aggroTargets.set(targetId, attackerId);
  }


  /**
   * Process one network tick worth of combat
   * Called exactly once per network tick for deterministic lockstep simulation
   */
  public override processTick(_tick: number): void {
    this.fixedUpdate(this.config.fixedTimestep);
  }

  /**
   * Fixed timestep combat update - deterministic
   *
   * IMPORTANT: For network determinism, attackers are processed in entity ID order
   * (guaranteed by queryEntities returning sorted results), and target selection
   * uses deterministic tie-breaking based on entity ID.
   */
  private fixedUpdate(deltaTime: number): void {
    // Query all entities with Attack and Team components
    // queryEntities returns entities sorted by ID for deterministic processing
    const attackers = this.entityManager.queryEntities(
      ComponentType.Attack,
      ComponentType.Team,
      ComponentType.Health
    ) as Unit[];

    for (const attacker of attackers) {
      const health = attacker.getComponent<HealthComponent>(
        ComponentType.Health
      );
      if (health?.isDestroyed) continue;

      const attackerTransform = attacker.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      if (!attackerTransform) continue;

      // Skip dying entities - check via DeathComponent for deterministic behavior
      // (AnimationComponent.isDying is set by frame-dependent animation system)
      const deathComp = attacker.getComponent<DeathComponent>(
        ComponentType.Death
      );
      if (deathComp?.isDying) continue;

      const attack = attacker.getComponent<AttackComponent>(
        ComponentType.Attack
      )!;
      const movement = attacker.getComponent<MovementComponent>(
        ComponentType.Movement
      );

      // Update attack cooldown with fixed timestep
      attack.updateCooldown(deltaTime);

      // Update attack lock timer (deterministic)
      const attackLock = attacker.getComponent<AttackLockComponent>(
        ComponentType.AttackLock
      );
      if (attackLock) {
        attackLock.update(deltaTime);
      }

      // Check for aggro target first (unit that attacked us)
      const aggroTargetId = this.aggroTargets.get(attacker.id);
      let aggroTarget: Unit | null = null;

      if (aggroTargetId !== undefined) {
        aggroTarget = (this.entityManager.getEntity(aggroTargetId) as Unit | undefined) ?? null;
        const aggroHealth = aggroTarget?.getComponent<HealthComponent>(
          ComponentType.Health
        );

        // Clear aggro if target is dead or doesn't exist
        if (!aggroTarget || aggroHealth?.isDestroyed) {
          this.aggroTargets.delete(attacker.id);
          aggroTarget = null;
        }
      }

      // Find target in detection range
      const target = this.findTarget(attacker, attackers, aggroTarget);
      const previousTargetId = this.currentTargets.get(attacker.id);

      if (target) {
        const targetTransform = target.getComponent<TransformComponent>(
          ComponentType.Transform
        );
        if (!targetTransform) continue;

        // We have a target in detection range
        // Use squared distances for deterministic comparison (avoids sqrt)
        const distanceSqToTarget = FPVector3.SqrDistance(
          attackerTransform.fpPosition,
          targetTransform.fpPosition
        );
        const attackRangeFP = FP.FromFloat(attack.range);
        const attackRangeSq = FP.Mul(attackRangeFP, attackRangeFP);
        const inAttackRange = FP.Lte(distanceSqToTarget, attackRangeSq);

        if (previousTargetId !== target.id) {
          // New target - store current movement target if moving
          if (movement?.isMoving && !this.storedMoveTargets.has(attacker.id)) {
            this.storedMoveTargets.set(
              attacker.id,
              movement.targetPosition.clone()
            );
          }
        }

        this.currentTargets.set(attacker.id, target.id);

        // Handle tower turret aiming
        const isTower = attacker instanceof Tower;
        if (isTower) {
          attacker.setTargetPosition(targetTransform.visualPosition);
          // Update deterministic aiming state (tick-based, not frame-based)
          attacker.simulateTurretAiming(deltaTime);
        }

        // Check if entity is currently attack-locked (via component)
        const attackLockComp = attacker.getComponent<AttackLockComponent>(
          ComponentType.AttackLock
        );
        const rotationComp = attacker.getComponent<RotationComponent>(
          ComponentType.Rotation
        );
        const isAttackLocked = attackLockComp?.isLocked ?? false;

        // Orient units toward their target only when:
        // 1. It's a new target, OR
        // 2. Not currently in attack animation (to avoid jitter during attack)
        if (rotationComp && !isAttackLocked) {
          this.eventBus.emit<OrientToTargetEvent>(GameEvents.ORIENT_TO_TARGET, {
            ...createEvent(),
            entityId: attacker.id,
            targetPosition: targetTransform.visualPosition.clone(),
          });
        }

        if (inAttackRange) {
          // Target is in attack range - stop and attack
          if (movement?.isMoving) {
            movement.stop();
          }

          // Attack if ready
          // For animated units: only attack if not already in attack animation
          // (animation length is the natural cooldown for melee)
          // For towers: also check if turret is aimed
          const canFire = isTower ? attacker.isAimedAtTarget : true;
          const canAttackAnim = !attackLockComp || !isAttackLocked;

          if (attack.canAttack() && canFire && canAttackAnim) {
            this.performAttack(attacker, target);
          }
        } else if (movement) {
          // Target detected but out of attack range - move toward target
          // But don't move if we're currently in an attack animation
          if (isAttackLocked) {
            // Don't move while attacking, but keep facing target
            if (movement.isMoving) {
              movement.stop();
            }
          } else {
            // Store original target if not already stored
            if (!this.storedMoveTargets.has(attacker.id)) {
              if (movement.isMoving) {
                this.storedMoveTargets.set(
                  attacker.id,
                  movement.targetPosition.clone()
                );
              } else {
                this.storedMoveTargets.set(
                  attacker.id,
                  attackerTransform.visualPosition.clone()
                );
              }
            }

            // Move towards the target (use callback for lockstep)
            this.requestMove(attacker.id, targetTransform.visualPosition.clone());

            // Notify that movement started for animation sync
            const animCompMove = attacker.getComponent<AnimationComponent>(
              ComponentType.Animation
            );
            if (animCompMove) {
              this.eventBus.emit<NotifyMovementStartedEvent>(GameEvents.NOTIFY_MOVEMENT_STARTED, {
                ...createEvent(),
                entityId: attacker.id,
              });
            }
          }
        }

        // Clear aggro if we killed our aggro target
        if (aggroTargetId === target.id) {
          const targetHealth = target.getComponent<HealthComponent>(
            ComponentType.Health
          );
          if (targetHealth?.isDestroyed) {
            this.aggroTargets.delete(attacker.id);
          }
        }
      } else if (aggroTarget && movement) {
        const aggroTargetTransform = aggroTarget.getComponent<TransformComponent>(
          ComponentType.Transform
        );
        if (!aggroTargetTransform) continue;

        // Aggro target exists but is out of range - move towards them
        // Use squared distance for deterministic comparison
        const distanceSq = FPVector3.SqrDistance(
          attackerTransform.fpPosition,
          aggroTargetTransform.fpPosition
        );
        const attackRangeFP = FP.FromFloat(attack.range);
        const attackRangeSq = FP.Mul(attackRangeFP, attackRangeFP);

        // Check if entity is currently attack-locked (via component)
        const attackLockAggro = attacker.getComponent<AttackLockComponent>(
          ComponentType.AttackLock
        );
        const isAttackLockedAggro = attackLockAggro?.isLocked ?? false;

        if (FP.Gt(distanceSq, attackRangeSq) && !isAttackLockedAggro) {
          // Store original target if not already stored
          if (!this.storedMoveTargets.has(attacker.id) && movement.isMoving) {
            this.storedMoveTargets.set(
              attacker.id,
              movement.targetPosition.clone()
            );
          } else if (
            !this.storedMoveTargets.has(attacker.id) &&
            !movement.isMoving
          ) {
            // If not moving, store current position as fallback
            this.storedMoveTargets.set(attacker.id, attackerTransform.visualPosition.clone());
          }

          // Move towards the aggro target (use callback for lockstep)
          this.requestMove(attacker.id, aggroTargetTransform.visualPosition.clone());

          // Notify that movement started for animation sync
          const animCompAggro = attacker.getComponent<AnimationComponent>(
            ComponentType.Animation
          );
          if (animCompAggro) {
            this.eventBus.emit<NotifyMovementStartedEvent>(GameEvents.NOTIFY_MOVEMENT_STARTED, {
              ...createEvent(),
              entityId: attacker.id,
            });
          }
        } else if (isAttackLockedAggro && movement.isMoving) {
          // Stop movement if attacking
          movement.stop();
        }
      } else {
        // No target in range and no aggro target
        // Clear current target tracking if we had one
        if (previousTargetId !== undefined) {
          this.currentTargets.delete(attacker.id);

          // Clear tower target
          if (attacker instanceof Tower) {
            attacker.setTargetPosition(null);
          }

          // End combat mode for animated units so they can transition to idle/run
          const animCompEnd = attacker.getComponent<AnimationComponent>(
            ComponentType.Animation
          );
          if (animCompEnd) {
            this.eventBus.emit<EndCombatEvent>(GameEvents.END_COMBAT, {
              ...createEvent(),
              entityId: attacker.id,
            });
          }
        }

        // Try to resume movement to original destination
        const storedTarget = this.storedMoveTargets.get(attacker.id);
        // Don't resume movement if entity is still attack-locked
        const attackLockResume = attacker.getComponent<AttackLockComponent>(
          ComponentType.AttackLock
        );
        const isAttackLockedResume = attackLockResume?.isLocked ?? false;

        if (storedTarget && movement && !isAttackLockedResume) {
          // Resume movement (use callback for lockstep)
          this.requestMove(attacker.id, storedTarget);
          this.storedMoveTargets.delete(attacker.id);

          // Orient entity along movement direction
          this.eventBus.emit<OrientToMovementDirectionEvent>(GameEvents.ORIENT_TO_MOVEMENT_DIRECTION, {
            ...createEvent(),
            entityId: attacker.id,
          });
        }
      }
    }
  }

  /**
   * Move an entity directly via MovementSystem.
   * Combat-initiated moves are deterministic simulation decisions that all
   * clients compute identically during tick processing, so they bypass
   * the network event path and execute immediately in the same tick.
   */
  private requestMove(entityId: number, target: Vector3): void {
    this.movementSystem.moveEntityTo(entityId, target);
  }

  /**
   * Find the closest hostile target in detection range
   * Uses detectionRange for finding targets, range for attacking
   * Prioritizes aggro target if it's in attack range
   *
   * IMPORTANT: Uses deterministic tie-breaking for network synchronization.
   * When two targets are at equal distance, the one with the lower entity ID
   * is chosen. This ensures all clients select the same target.
   */
  private findTarget(
    attacker: Unit,
    allCombatants: Unit[],
    aggroTarget: Unit | null
  ): Unit | null {
    const attackerTeam = attacker.getComponent<TeamComponent>(
      ComponentType.Team
    )!;
    const attack = attacker.getComponent<AttackComponent>(
      ComponentType.Attack
    )!;
    const attackerTransform = attacker.getComponent<TransformComponent>(
      ComponentType.Transform
    );
    if (!attackerTransform) return null;

    // Use detectionRange for finding targets (defaults to attack range if not set)
    const detectionRange = attack.detectionRange;
    const detectionRangeFP = FP.FromFloat(detectionRange);
    const detectionRangeSq = FP.Mul(detectionRangeFP, detectionRangeFP);
    const attackRangeFP = FP.FromFloat(attack.range);
    const attackRangeSq = FP.Mul(attackRangeFP, attackRangeFP);

    // If we have an aggro target in attack range, prioritize it (unless dying)
    if (aggroTarget) {
      // Skip dying entities as aggro targets - use DeathComponent for determinism
      const aggroDeathComp = aggroTarget.getComponent<DeathComponent>(
        ComponentType.Death
      );
      const isDying = aggroDeathComp?.isDying ?? false;
      const aggroHealth = aggroTarget.getComponent<HealthComponent>(
        ComponentType.Health
      );
      const aggroTransform = aggroTarget.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      if (!aggroHealth?.isDestroyed && !isDying && aggroTransform) {
        // Use squared distance for deterministic comparison
        const aggroDistanceSq = FPVector3.SqrDistance(
          attackerTransform.fpPosition,
          aggroTransform.fpPosition
        );
        if (FP.Lte(aggroDistanceSq, attackRangeSq)) {
          return aggroTarget;
        }
      }
    }

    let closestTarget: Unit | null = null;
    // Use fixed-point squared distance for deterministic comparison
    let closestDistanceSq: FixedPoint | null = null;

    for (const potential of allCombatants) {
      if (potential.id === attacker.id) continue;

      const health = potential.getComponent<HealthComponent>(
        ComponentType.Health
      );
      if (health?.isDestroyed) continue;

      // Skip dying entities as potential targets - use DeathComponent for determinism
      const potentialDeathComp = potential.getComponent<DeathComponent>(
        ComponentType.Death
      );
      if (potentialDeathComp?.isDying) continue;

      const targetTeam = potential.getComponent<TeamComponent>(
        ComponentType.Team
      );
      if (!targetTeam || !attackerTeam.isHostileTo(targetTeam)) continue;

      const potentialTransform = potential.getComponent<TransformComponent>(
        ComponentType.Transform
      );
      if (!potentialTransform) continue;

      // Use squared distance for deterministic comparison (avoids non-deterministic sqrt)
      const distanceSq = FPVector3.SqrDistance(
        attackerTransform.fpPosition,
        potentialTransform.fpPosition
      );

      // Use detectionRange (squared) for finding targets
      if (FP.Lte(distanceSq, detectionRangeSq)) {
        // Deterministic tie-breaking: prefer lower entity ID when distances are equal
        // Use fixed-point comparison with small epsilon for tie-breaking
        const isFirstTarget = closestDistanceSq === null;
        const isCloser =
          !isFirstTarget &&
          FP.Lt(distanceSq, FP.Sub(closestDistanceSq!, FP_DISTANCE_EPSILON_SQ));
        const isSameDistance =
          !isFirstTarget &&
          FP.Lte(FP.Abs(FP.Sub(distanceSq, closestDistanceSq!)), FP_DISTANCE_EPSILON_SQ);
        const hasLowerIdTieBreak =
          isSameDistance &&
          (closestTarget === null || potential.id < closestTarget.id);

        if (isFirstTarget || isCloser || hasLowerIdTieBreak) {
          closestDistanceSq = distanceSq;
          closestTarget = potential;
        }
      }
    }

    return closestTarget;
  }

  /**
   * Perform an attack from attacker to target
   * Uses GameRandom for deterministic critical hit calculation
   *
   * For melee attacks (projectileSpeed === 0), damage is applied directly.
   * For ranged attacks, a projectile is spawned.
   */
  private performAttack(attacker: Unit, target: Unit): void {
    const attack = attacker.getComponent<AttackComponent>(
      ComponentType.Attack
    )!;
    const team = attacker.getComponent<TeamComponent>(ComponentType.Team)!;

    // Calculate damage with critical hit chance (deterministic via GameRandom)
    let damage = attack.damage;
    let isCritical = false;

    if (GameRandom.isInitialized()) {
      isCritical = GameRandom.boolean(this.config.criticalHitChance);
      if (isCritical) {
        damage = Math.floor(damage * this.config.criticalHitMultiplier);
      }
    }

    // Handle attack based on attack type
    if (attack.isMelee) {
      this.performMeleeAttack(attacker, target, damage);
    } else {
      this.performRangedAttack(attacker, target, attack, team, damage);
    }

    // Reset cooldown
    attack.onAttackPerformed();
  }

  /**
   * Perform a melee attack
   *
   * IMPORTANT FOR DETERMINISM: Damage is applied IMMEDIATELY during the simulation tick,
   * not at the animation hit point. The animation is purely visual.
   * This ensures all clients deal damage at exactly the same simulation tick.
   */
  private performMeleeAttack(
    attacker: Unit,
    target: Unit,
    damage: number
  ): void {
    // Apply damage immediately for deterministic simulation
    // All clients will apply damage at the exact same simulation tick
    this.eventBus.emit<DamageRequestedEvent>(GameEvents.DAMAGE_REQUESTED, {
      ...createEvent(),
      entityId: target.id,
      amount: damage,
      sourceId: attacker.id,
    });

    // Trigger attack animation (purely visual)
    const animComp = attacker.getComponent<AnimationComponent>(
      ComponentType.Animation
    );
    const attackLockComp = attacker.getComponent<AttackLockComponent>(
      ComponentType.AttackLock
    );

    if (animComp) {
      // Emit event for attack animation - damage already applied above
      this.eventBus.emit<PlayAttackAnimationEvent>(GameEvents.PLAY_ATTACK_ANIMATION, {
        ...createEvent(),
        entityId: attacker.id,
      });
    }

    if (attackLockComp) {
      attackLockComp.startLock(); // Deterministic movement lock
    }
  }

  /**
   * Perform a ranged attack by spawning a projectile
   */
  private performRangedAttack(
    attacker: Unit,
    target: Unit,
    attack: AttackComponent,
    team: TeamComponent,
    damage: number
  ): void {
    const attackerTransform = attacker.getComponent<TransformComponent>(ComponentType.Transform);
    const targetTransform = target.getComponent<TransformComponent>(ComponentType.Transform);
    if (!attackerTransform || !targetTransform) return;

    // Calculate origin and direction (special handling for towers with rotating turrets)
    let origin: Vector3;
    let direction: Vector3;

    if (attacker instanceof Tower) {
      // Use barrel tip position for towers, but calculate direction to target
      origin = attacker.getBarrelTipPosition();
      // Calculate the direction from barrel tip to target (not just horizontal barrel direction)
      direction = targetTransform.visualPosition.subtract(origin).normalize();
    } else {
      // Standard attack origin for other entities
      origin = attack.getAttackOrigin(attackerTransform.visualPosition);
      direction = targetTransform.visualPosition.subtract(origin).normalize();
    }

    // Emit projectile spawn event instead of calling ProjectileSystem directly
    this.eventBus.emit<ProjectileSpawnedEvent>(GameEvents.PROJECTILE_SPAWNED, {
      ...createEvent(),
      origin: origin.clone(),
      direction: direction.clone(),
      damage: damage,
      speed: attack.projectileSpeed,
      team: team.team,
      sourceId: attacker.id,
    });
  }


  /**
   * Frame-based update for visual elements
   * Called every render frame for smooth visuals
   */
  public override update(deltaTime: number): void {
    this.updateTowerTurrets(deltaTime);
  }

  /**
   * Update tower turret rotations for smooth visual rotation
   * Should be called in the render loop (not simulation tick) for smooth visuals
   */
  private updateTowerTurrets(deltaTime: number): void {
    // Query all entities with Attack and Team components
    const attackers = this.entityManager.queryEntities(
      ComponentType.Attack,
      ComponentType.Team,
      ComponentType.Health
    ) as Unit[];

    for (const attacker of attackers) {
      if (attacker instanceof Tower) {
        const health = attacker.getComponent<HealthComponent>(
          ComponentType.Health
        );
        if (!health?.isDestroyed) {
          attacker.updateTurretRotation(deltaTime);
        }
      }
    }
  }

  /**
   * Dispose and cleanup
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.currentTargets.clear();
    this.storedMoveTargets.clear();
    this.aggroTargets.clear();
  }
}
