import type { CommandsBatch, PlayerCommand, EventBus, EntityManager } from 'phalanx-ecs';
import { FP } from 'phalanx-math';
import { StateHasher } from 'phalanx-client';
import type { PhalanxClient } from 'phalanx-client';
import { FLICK_EXECUTED } from '../events/GameEvents.ts';
import type { FlickExecutedEvent } from '../events/GameEvents.ts';
import { ComponentType } from '../components/Component.ts';
import type { CheckerComponent } from '../components/CheckerComponent.ts';
import type { GameStateComponent } from '../components/GameStateComponent.ts';
import type { PhysicsBodyComponent } from '../components/PhysicsBodyComponent.ts';
import type { TransformComponent } from '../components/TransformComponent.ts';
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

/** Interval (in ticks) between state hash submissions */
const HASH_INTERVAL = 60;

/**
 * LockstepManager — processes commands from the server's commands-batch
 * and applies them deterministically on the local ECS.
 *
 * Only one command type exists in Chapayev: `flick`.
 *
 * Also handles state hashing for desync detection.
 */
export class LockstepManager {
  private readonly client: PhalanxClient;
  private readonly eventBus: EventBus;
  private readonly entityManager: EntityManager;

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
   * Process a tick's command batch. Called from GameWorld.start({ beforeTick }).
   * Extracts flick commands and emits them as FLICK_EXECUTED events so that
   * PhysicsSystem processes them identically on all clients.
   */
  public processTick(_tick: number, commandsBatch: CommandsBatch): void {
    // Flatten commands from all players in deterministic order (sorted by playerId)
    const allCommands: PlayerCommand[] = [];
    const sortedPlayerIds = Object.keys(commandsBatch.commands).sort();
    for (const playerId of sortedPlayerIds) {
      allCommands.push(...commandsBatch.commands[playerId]);
    }

    for (const cmd of allCommands) {
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
    if (!entity) return;

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
   * Submit a state hash every HASH_INTERVAL ticks for desync detection.
   */
  public submitHashIfNeeded(tick: number): void {
    if (tick % HASH_INTERVAL !== 0) return;

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
      hasher.addString(FP.ToRaw(physicsBody.velocityX).toString());
      hasher.addString(FP.ToRaw(physicsBody.velocityZ).toString());
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
