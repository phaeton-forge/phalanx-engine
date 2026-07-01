import type { PlayerCommand, EventBus, EntityManager } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { StateHasher } from '@phalanx-engine/client';
import type { PhalanxClient, CommandsBatchEvent } from '@phalanx-engine/client';
import { FLICK_EXECUTED } from '../events/GameEvents.ts';
import type { FlickExecutedEvent } from '../events/GameEvents.ts';
import { ComponentType } from '../components/Component.ts';
import type { CheckerComponent } from '../components/CheckerComponent.ts';
import type { GameStateComponent } from '../components/GameStateComponent.ts';
import type { PhysicsBodyComponent, TransformComponent } from '../components';
import { TeamTag } from '../enums/TeamTag.ts';

/**
 * Serialised flick command sent over the wire.
 * All FixedPoint values are serialised as raw bigint strings for exact reproduction.
 */
export interface FlickCommandData {
  entityId: number;
  dirX: string;   // FP.ToRaw() → bigint → toString()
  dirZ: string;
  force: string;
}

/**
 * LockstepManager — processes commands from the server's commands-batch
 * and applies them deterministically on the local ECS.
 *
 * In event tick mode, commands arrive asynchronously from PhalanxClient
 * 'commands' events (not from GameWorld tick hooks). The local ECS runs
 * its own 60Hz physics loop; this manager bridges network commands into
 * the local event bus.
 *
 * Only one command type exists in Chapayev: `flick`.
 *
 * Also handles state hashing for desync detection (at ALL_SETTLED).
 */
export class LockstepManager {
  private readonly client: PhalanxClient;
  private readonly eventBus: EventBus;
  private readonly entityManager: EntityManager;

  /** Last server tick from a commands-batch (used as hash identifier) */
  private lastServerTick = 0;

  constructor(
    client: PhalanxClient,
    eventBus: EventBus,
    entityManager: EntityManager,
  ) {
    this.client = client;
    this.eventBus = eventBus;
    this.entityManager = entityManager;
  }

  /**
   * Queue a flick command to be sent to the server.
   * Called from FlickInputSystem when the local player flicks in online mode.
   */
  public queueFlickCommand(data: FlickCommandData): void {
    this.client.sendCommand('flick', data);
  }

  /**
   * Handle an incoming commands-batch event from PhalanxClient.
   * Called from the Game's commands-batch event listener (event tick mode).
   * Extracts flick commands and emits FLICK_EXECUTED events so that
   * PhysicsSystem processes them identically on all clients.
   */
  public handleIncomingCommands(batch: CommandsBatchEvent): void {
    this.lastServerTick = batch.tick;

    for (const cmd of batch.commands) {
      if (cmd.type === 'flick') {
        this.handleFlickCommand(cmd);
      } else {
        console.warn(`[Lockstep] Unknown command type: ${cmd.type}`);
      }
    }
  }

  private isFlickCommandData(value: unknown): value is FlickCommandData {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return (
      typeof obj.entityId === 'number' &&
      typeof obj.dirX === 'string' &&
      typeof obj.dirZ === 'string' &&
      typeof obj.force === 'string'
    );
  }

  private parseFlickCommandRawValues(
    data: FlickCommandData,
  ): { dirX: bigint; dirZ: bigint; force: bigint } | null {
    try {
      return {
        dirX: BigInt(data.dirX),
        dirZ: BigInt(data.dirZ),
        force: BigInt(data.force),
      };
    } catch {
      console.warn('[Lockstep] Failed to parse BigInt values from flick command', data);
      return null;
    }
  }

  /**
   * Deserialise a flick command and emit a FLICK_EXECUTED event.
   * PhysicsSystem already listens for these and applies the impulse.
   */
  private handleFlickCommand(cmd: PlayerCommand): void {
    if (!this.isFlickCommandData(cmd.data)) {
      console.warn('[Lockstep] Invalid flick command data', cmd.data);
      return;
    }

    const data = cmd.data;
    const entity = this.entityManager.getEntity(data.entityId);
    if (!entity) {
      // Don't drop the command silently — a mismatched entity id is
      // the symptom of a determinism break (most often a global
      // entity-id counter that wasn't reset before bootstrap on one
      // side). Logging it here makes the bug visible the next time it
      // surfaces instead of leaving the user staring at a frozen
      // board until `turn-timeout` ends the match.
      console.warn(
        '[Lockstep] Flick command targets unknown entity — likely a determinism break',
        {
          entityId: data.entityId,
          playerId: cmd.playerId,
          serverTick: this.lastServerTick,
        },
      );
      return;
    }

    const rawValues = this.parseFlickCommandRawValues(data);
    if (!rawValues) return;

    const checker = entity.getComponent<CheckerComponent>(ComponentType.Checker);
    const team = checker?.team ?? TeamTag.White;

    this.eventBus.emit<FlickExecutedEvent>(FLICK_EXECUTED, {
      entityId: data.entityId,
      team,
      directionX: FP.FromRaw(rawValues.dirX),
      directionZ: FP.FromRaw(rawValues.dirZ),
      force: FP.FromRaw(rawValues.force),
    });
  }

  /**
   * Submit a state hash for desync detection.
   * In event tick mode, call this when physics settles (ALL_SETTLED)
   * using the last server tick as the hash identifier.
   */
  public submitHashOnSettle(): void {
    this.submitHash(this.lastServerTick);
  }

  private submitHash(tick: number): void {
    const hasher = new StateHasher();
    hasher.addInt(tick);

    // Hash all checkers sorted by entity ID
    const checkerEntities = this.entityManager.queryEntities(
      ComponentType.Checker,
      ComponentType.PhysicsBody,
      ComponentType.Transform,
    );

    // queryEntities returns sorted by entity ID (deterministic)
    for (const entity of checkerEntities) {
      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform)!;
      const physicsBody = entity.getComponent<PhysicsBodyComponent>(ComponentType.PhysicsBody)!;
      const checker = entity.getComponent<CheckerComponent>(ComponentType.Checker)!;

      const fpPos = transform.fpPosition;
      hasher.addInt(entity.id);
      hasher.addString(FP.ToRaw(fpPos.x).toString());
      hasher.addString(FP.ToRaw(fpPos.z).toString());
      const velocity = physicsBody.velocity;
      hasher.addString(FP.ToRaw(velocity.x).toString());
      hasher.addString(FP.ToRaw(velocity.z).toString());
      hasher.addBool(checker.isAlive);
    }

    // Hash game state
    const gsEntities = this.entityManager.queryEntities(ComponentType.GameState);
    if (gsEntities.length > 0) {
      const gs = gsEntities[0].getComponent<GameStateComponent>(ComponentType.GameState)!;
      hasher.addInt(gs.roundNumber);
      hasher.addString(gs.currentTeam);
      hasher.addInt(gs.whiteRow);
      hasher.addInt(gs.blackRow);
    }

    this.client.submitStateHash(tick, hasher.finalize());
  }
}
