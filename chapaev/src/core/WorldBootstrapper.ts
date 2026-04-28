import { GameWorld, Entity } from 'phalanx-ecs';
import type { SceneContext } from '../rendering';
import {
  ThreeRenderSystem,
  PhysicsSystem,
  GameRulesSystem,
  FlickInputSystem,
  RapierVFXSystem,
  SoundSystem,
  InterpolationSystem,
} from '../systems';
import {
  ComponentType,
  GameStateComponent,
  InterpolationComponent,
  PlayerComponent,
} from '../components';
import type { CheckerComponent } from '../components';
import { createBoardEntity, createCheckerEntity } from '../entities';
import { INITIAL_POSITIONS } from '../config/constants.ts';
import { TeamTag } from '../enums/TeamTag.ts';
import { LockstepManager } from '../network';
import type { NetworkManager } from '../network';
import { ALL_SETTLED } from '../events';
import type { GameMode } from './Game.ts';

export interface BootstrappedWorld {
  world: GameWorld;
  flickInputSystem: FlickInputSystem;
  /** Present only in online mode. */
  interpolationSystem: InterpolationSystem | null;
  /** Present only in online mode. */
  lockstepManager: LockstepManager | null;
}

/**
 * Builds the ECS world: entities, systems, mesh-map wiring, and
 * (in online mode) the lockstep bridge. The actual `world.start(...)`
 * call is left to the caller — it differs by mode (hotseat skips the
 * interpolation hooks).
 */
export function bootstrapWorld(
  mode: GameMode,
  sceneCtx: SceneContext,
  networkManager: NetworkManager | null
): BootstrappedWorld {
  const world = new GameWorld({
    componentTypes: Object.values(ComponentType),
    tickRate: 60,
  });

  createEntities(world, mode);
  if (mode === 'online' && networkManager?.matchData) {
    assignPlayerComponents(world, networkManager);
  }

  const physicsSystem = new PhysicsSystem();
  const gameRulesSystem = new GameRulesSystem();
  const flickInputSystem = new FlickInputSystem(
    sceneCtx.camera,
    sceneCtx.renderer.domElement,
    sceneCtx.scene,
    sceneCtx.controls
  );
  const renderSystem = new ThreeRenderSystem(sceneCtx.scene);
  const rapierVFXSystem = new RapierVFXSystem();
  const soundSystem = new SoundSystem();

  const tickSystems = [physicsSystem, gameRulesSystem];
  const frameSystems: Array<
    | FlickInputSystem
    | ThreeRenderSystem
    | RapierVFXSystem
    | SoundSystem
    | InterpolationSystem
  > = [flickInputSystem, renderSystem, rapierVFXSystem, soundSystem];

  let interpolationSystem: InterpolationSystem | null = null;
  let lockstepManager: LockstepManager | null = null;

  if (mode === 'online' && networkManager) {
    interpolationSystem = new InterpolationSystem();
    frameSystems.push(interpolationSystem);

    lockstepManager = new LockstepManager(
      networkManager.client,
      world.eventBus,
      world.entityManager
    );

    flickInputSystem.setNetworkMode(
      lockstepManager,
      networkManager.matchData?.teamId === 1 ? TeamTag.Black : TeamTag.White
    );

    networkManager.onCommandsBatch((batch) => {
      lockstepManager!.handleIncomingCommands(batch);
    });

    world.eventBus.on(ALL_SETTLED, () => {
      lockstepManager!.submitHashOnSettle();
    });
  }

  world.registerSystems(tickSystems, frameSystems);

  const meshMap = renderSystem.getMeshMap();
  flickInputSystem.setMeshMap(meshMap);
  rapierVFXSystem.setMeshMap(meshMap);

  return { world, flickInputSystem, interpolationSystem, lockstepManager };
}

function createEntities(world: GameWorld, mode: GameMode): void {
  const em = world.entityManager;
  em.addEntity(createBoardEntity());

  for (const placement of INITIAL_POSITIONS) {
    const team = placement.team === 'white' ? TeamTag.White : TeamTag.Black;
    const entity = createCheckerEntity(team, placement.position);

    if (mode === 'online') {
      entity.addComponent(new InterpolationComponent(placement.position));
    }
    em.addEntity(entity);
  }

  const gsEntity = new Entity();
  gsEntity.addComponent(new GameStateComponent(TeamTag.White));
  em.addEntity(gsEntity);
}

/**
 * Assign PlayerComponent to each checker based on deterministic player ordering.
 * Player 0 = white, Player 1 = black.
 */
function assignPlayerComponents(
  world: GameWorld,
  networkManager: NetworkManager
): void {
  const matchData = networkManager.matchData;
  if (!matchData) return;

  const allPlayerIds = [
    matchData.playerId,
    ...matchData.teammates.map((p) => p.playerId),
    ...matchData.opponents.map((p) => p.playerId),
  ].sort();

  const checkerEntities = world.entityManager.queryEntities(
    ComponentType.Checker
  );
  for (const entity of checkerEntities) {
    const checker = entity.getComponent<CheckerComponent>(
      ComponentType.Checker
    );
    if (!checker) continue;

    const playerIndex = checker.team === TeamTag.White ? 0 : 1;
    const networkId = allPlayerIds[playerIndex] ?? '';
    entity.addComponent(new PlayerComponent(playerIndex, networkId));
  }
}
