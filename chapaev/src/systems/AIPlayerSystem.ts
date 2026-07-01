import { GameSystem } from '@phalanx-engine/ecs';
import type { SystemContext } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { ComponentType } from '../components';
import type {
  GameStateComponent,
  CheckerComponent,
  TransformComponent,
} from '../components';
import { TeamTag } from '../enums/TeamTag.ts';
import { FLICK_EXECUTED } from '../events';
import type { FlickExecutedEvent } from '../events';
import { MAX_FLICK_FORCE, FRICTION } from '../config/constants.ts';

/** Delay before the AI commits its move (seconds). Gives the player a chance to see what's happening. */
const AI_THINK_DELAY_SECONDS = 0.8;

/** Maximum relative deviation applied to the computed force (±10%). */
const AI_FORCE_NOISE = 0.5;

/** Maximum absolute deviation applied to the computed angle (±10°). */
const AI_ANGLE_NOISE_DEG = 8;

/** Safety multiplier applied on top of the friction-derived force baseline. */
const AI_FORCE_SAFETY = 3.7;

/** Minimum impulse magnitude — prevents underpowered flicks at very short distances. */
const AI_MIN_FORCE = 16;

interface CheckerSnapshot {
  readonly entityId: number;
  readonly x: number;
  readonly z: number;
}

/**
 * AIPlayerSystem — frame system that controls one team via simple heuristics.
 *
 * Logic per turn:
 *   1. Pick a random alive friendly checker as the attacker.
 *   2. Find the nearest alive enemy checker as the target.
 *   3. Compute the ideal direction/force toward the target.
 *   4. Add ±10° angle noise and ±10% force noise to model imperfect aim.
 *   5. Emit FLICK_EXECUTED — same path the human player uses in hot-seat mode.
 *
 * The system polls each frame so it naturally re-fires on consecutive AI turns
 * (e.g. when the AI scores a hit and keeps the turn).
 */
export class AIPlayerSystem extends GameSystem {
  private readonly aiTeam: TeamTag;
  private gameState!: GameStateComponent;

  /** Countdown timer (seconds) until the queued move executes. */
  private thinkTimer = 0;

  /** Whether a move is currently queued for the active aiming phase. */
  private moveQueued = false;

  constructor(aiTeam: TeamTag) {
    super();
    this.aiTeam = aiTeam;
  }

  public override init(context: SystemContext): void {
    super.init(context);
    const gsEntities = this.entityManager.queryEntities(
      ComponentType.GameState
    );
    if (gsEntities.length === 0) {
      throw new Error(
        'AIPlayerSystem: no entity with GameStateComponent found'
      );
    }
    this.gameState = gsEntities[0].getComponent<GameStateComponent>(
      ComponentType.GameState
    )!;
  }

  public override update(deltaTime: number): void {
    if (!this.enabled) return;

    const isAiTurn =
      this.gameState.currentTeam === this.aiTeam &&
      this.gameState.phase === 'aiming';

    if (!isAiTurn) {
      this.moveQueued = false;
      return;
    }

    if (!this.moveQueued) {
      this.moveQueued = true;
      this.thinkTimer = AI_THINK_DELAY_SECONDS;
      return;
    }

    this.thinkTimer -= deltaTime;
    if (this.thinkTimer > 0) return;

    this.moveQueued = false;
    this.executeMove();
  }

  private executeMove(): void {
    const friendly = this.collectAliveCheckers(this.aiTeam);
    if (friendly.length === 0) return;

    const opponentTeam =
      this.aiTeam === TeamTag.White ? TeamTag.Black : TeamTag.White;
    const enemies = this.collectAliveCheckers(opponentTeam);
    if (enemies.length === 0) return;

    const attacker = friendly[Math.floor(Math.random() * friendly.length)];
    const target = this.findNearest(attacker, enemies);
    if (!target) return;

    const dx = target.x - attacker.x;
    const dz = target.z - attacker.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance <= 0) return;

    const noisyAngle = this.computeNoisyAngle(dx, dz);
    const noisyForce = this.computeNoisyForce(distance);

    const dirX = Math.cos(noisyAngle);
    const dirZ = Math.sin(noisyAngle);

    this.eventBus.emit<FlickExecutedEvent>(FLICK_EXECUTED, {
      entityId: attacker.entityId,
      team: this.aiTeam,
      directionX: FP.FromFloat(dirX),
      directionZ: FP.FromFloat(dirZ),
      force: FP.FromFloat(noisyForce),
    });
  }

  private collectAliveCheckers(team: TeamTag): CheckerSnapshot[] {
    const result: CheckerSnapshot[] = [];
    const entities = this.entityManager.queryEntities(
      ComponentType.Checker,
      ComponentType.Transform
    );

    for (const entity of entities) {
      const checker = entity.getComponent<CheckerComponent>(
        ComponentType.Checker
      )!;
      if (checker.team !== team || !checker.isAlive) continue;

      const transform = entity.getComponent<TransformComponent>(
        ComponentType.Transform
      )!;
      const fp = transform.fpPosition;
      result.push({
        entityId: entity.id,
        x: FP.ToFloat(fp.x),
        z: FP.ToFloat(fp.z),
      });
    }

    return result;
  }

  private findNearest(
    from: CheckerSnapshot,
    candidates: CheckerSnapshot[]
  ): CheckerSnapshot | null {
    let nearest: CheckerSnapshot | null = null;
    let nearestDistSq = Infinity;

    for (const candidate of candidates) {
      const dx = candidate.x - from.x;
      const dz = candidate.z - from.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = candidate;
      }
    }

    return nearest;
  }

  private computeNoisyAngle(dx: number, dz: number): number {
    const baseAngle = Math.atan2(dz, dx);
    const noiseRad = (AI_ANGLE_NOISE_DEG * Math.PI) / 180;
    const offset = (Math.random() * 2 - 1) * noiseRad;
    return baseAngle + offset;
  }

  /**
   * Choose a force that should travel roughly the requested distance under
   * the game's friction model, then perturb it by ±10%.
   *
   * Friction is applied as a per-tick multiplicative damping, so the total
   * travel distance approximates `v0 / FRICTION`. We invert that and add a
   * small safety factor to account for collisions along the way.
   */
  private computeNoisyForce(distance: number): number {
    const baseline = distance * FRICTION * AI_FORCE_SAFETY;
    const clamped = Math.min(MAX_FLICK_FORCE, Math.max(AI_MIN_FORCE, baseline));
    const multiplier = 1 + (Math.random() * 2 - 1) * AI_FORCE_NOISE;
    return Math.min(
      MAX_FLICK_FORCE,
      Math.max(AI_MIN_FORCE * 0.5, clamped * multiplier)
    );
  }
}
