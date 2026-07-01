import { GameWorld, Entity } from '@phalanx-engine/ecs';
import { FP } from '@phalanx-engine/math';
import { PhysicsSystem, InterpolationSystem } from '@phalanx-engine/physics';
import type { PhysicsConfig } from '@phalanx-engine/physics';
import type { SceneContext } from '../rendering';
import {
  ThreeRenderSystem,
  GameRulesSystem,
  FlickInputSystem,
  RapierVFXSystem,
  SoundSystem,
  PhysicsEventAdapterSystem,
  AIPlayerSystem,
} from '../systems';
import {
  ComponentType,
  GameStateComponent,
  InterpolationComponent,
  PlayerComponent,
} from '../components';
import type { CheckerComponent } from '../components';
import { createBoardEntity, createCheckerEntity } from '../entities';
import {
  INITIAL_POSITIONS,
  PHYSICS_DT,
  MAX_FLICK_FORCE,
  FRICTION,
  BOARD_ELIM_HALF_EXTENT,
  CELL_SIZE,
  RESTITUTION,
} from '../config/constants.ts';
import { TeamTag } from '../enums/TeamTag.ts';
import { LockstepManager } from '../network';
import type { NetworkManager } from '../network';
import { ALL_SETTLED } from '../events';
import type { GameMode } from './Game.ts';

/**
 * Build the deterministic physics configuration for the library PhysicsSystem.
 *
 * subSteps=1 keeps the friction model equivalent to the legacy per-tick
 * damping (a single multiplicative decay per tick, see CheckerEntity). Bodies
 * that leave the elimination boundary are ejected (ignorePhysics + zeroed
 * velocity) and surface a BOUNDS_EXIT event that the adapter turns into a
 * CHECKER_ELIMINATED gameplay event.
 */
function buildPhysicsConfig(): PhysicsConfig {
  const half = FP.FromFloat(BOARD_ELIM_HALF_EXTENT);
  return {
    tickDt: FP.FromFloat(PHYSICS_DT),
    subSteps: 1,
    maxVelocity: FP.FromFloat(MAX_FLICK_FORCE),
    defaultFriction: FP.FromFloat(1 - FRICTION * PHYSICS_DT),
    pushStrength: FP.FromFloat(15),
    // Chapayev needs momentum transfer ("click / knock-away"), not the default
    // push separation — a flicked checker must knock the struck one away.
    collisionResponse: 'impulse',
    restitution: FP.FromFloat(RESTITUTION),
    gridCellSize: FP.FromFloat(CELL_SIZE),
    worldBounds: {
      minX: FP.Neg(half),
      minZ: FP.Neg(half),
      maxX: half,
      maxZ: half,
    },
    ejectOnBoundsExit: true,
  };
}

export interface BootstrappedWorld {
  world: GameWorld;
  flickInputSystem: FlickInputSystem;
  /** Drives the render transform interpolation. Present in all modes. */
  interpolationSystem: InterpolationSystem;
  /** Present only in online mode. */
  lockstepManager: LockstepManager | null;
}

/**
 * Builds the ECS world: entities, systems, mesh-map wiring, and
 * (in online mode) the lockstep bridge. The actual `world.start(...)`
 * call is left to the caller.
 *
 * The library InterpolationSystem runs its snapshot/capture/interpolate steps
 * automatically via GameWorld lifecycle hooks, so no manual driving is needed.
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

  createEntities(world);
  if (mode === 'online' && networkManager?.matchData) {
    assignPlayerComponents(world, networkManager);
  }

  const physicsSystem = new PhysicsSystem(buildPhysicsConfig());
  const physicsEventAdapter = new PhysicsEventAdapterSystem(physicsSystem);
  const gameRulesSystem = new GameRulesSystem();
  const interpolationSystem = new InterpolationSystem();
  const flickInputSystem = new FlickInputSystem(
    sceneCtx.camera,
    sceneCtx.renderer.domElement,
    sceneCtx.scene,
    sceneCtx.controls
  );
  const renderSystem = new ThreeRenderSystem(sceneCtx.scene, interpolationSystem);
  const rapierVFXSystem = new RapierVFXSystem();
  const soundSystem = new SoundSystem();

  // Order matters: physics integrates, the adapter observes physics events
  // (emitting ALL_SETTLED before GameRulesSystem reads it), then rules run.
  const tickSystems = [physicsSystem, physicsEventAdapter, gameRulesSystem];
  const frameSystems: Array<
    | FlickInputSystem
    | ThreeRenderSystem
    | RapierVFXSystem
    | SoundSystem
    | InterpolationSystem
    | AIPlayerSystem
  > = [flickInputSystem, renderSystem, rapierVFXSystem, soundSystem, interpolationSystem];

  if (mode === 'ai' || mode === 'online_ai') {
    // AI plays the black team; the human controls white.
    frameSystems.push(new AIPlayerSystem(TeamTag.Black));
    flickInputSystem.setLocalTeam(TeamTag.White);
  }

  let lockstepManager: LockstepManager | null = null;

  if (mode === 'online' && networkManager) {
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

function createEntities(world: GameWorld): void {
  const em = world.entityManager;
  em.addEntity(createBoardEntity());

  for (const placement of INITIAL_POSITIONS) {
    const team = placement.team === 'white' ? TeamTag.White : TeamTag.Black;
    const entity = createCheckerEntity(team, placement.position);
    entity.addComponent(new InterpolationComponent(placement.position));
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
