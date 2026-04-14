import { GameWorld, Entity } from 'phalanx-ecs';
import { setupScene } from '../rendering/SceneSetup.ts';
import type { SceneContext } from '../rendering/SceneSetup.ts';
import { ThreeRenderSystem } from '../systems/ThreeRenderSystem.ts';
import { PhysicsSystem } from '../systems/PhysicsSystem.ts';
import { GameRulesSystem } from '../systems/GameRulesSystem.ts';
import { FlickInputSystem } from '../systems/FlickInputSystem.ts';
import { RapierVFXSystem } from '../systems/RapierVFXSystem.ts';
import { SoundSystem } from '../systems/SoundSystem.ts';
import { ComponentType } from '../components/Component.ts';
import { GameStateComponent } from '../components/GameStateComponent.ts';
import { createBoardEntity } from '../entities/BoardEntity.ts';
import { createCheckerEntity } from '../entities/CheckerEntity.ts';
import { INITIAL_POSITIONS } from '../config/constants.ts';
import { TeamTag } from '../enums/TeamTag.ts';

/**
 * Game — thin orchestrator that wires together the ECS world,
 * Three.js scene, and the render loop.
 *
 * No game logic lives here — only setup and lifecycle management.
 */
export class Game {
  private world: GameWorld;
  private sceneCtx: SceneContext;

  constructor(canvas: HTMLCanvasElement) {
    // ── Three.js scene ─────────────────────────────────────────
    this.sceneCtx = setupScene(canvas);

    // ── ECS world (single-player, no tickFrameProvider) ────────
    this.world = new GameWorld({
      componentTypes: Object.values(ComponentType),
      tickRate: 60,
    });

    // ── Create entities ────────────────────────────────────────
    this.createEntities();

    // ── Systems ────────────────────────────────────────────────
    const physicsSystem = new PhysicsSystem();
    const gameRulesSystem = new GameRulesSystem();
    const flickInputSystem = new FlickInputSystem(
      this.sceneCtx.camera,
      this.sceneCtx.renderer.domElement,
      this.sceneCtx.scene,
      this.sceneCtx.controls,
    );
    const renderSystem = new ThreeRenderSystem(this.sceneCtx.scene);
    const rapierVFXSystem = new RapierVFXSystem();
    const soundSystem = new SoundSystem();

    // Tick systems: physics first, then rules
    const tickSystems = [physicsSystem, gameRulesSystem];

    // Frame systems: input → render → rapier VFX → sound
    const frameSystems = [flickInputSystem, renderSystem, rapierVFXSystem, soundSystem];

    this.world.registerSystems(tickSystems, frameSystems);

    // Wire up mesh map after systems are initialised
    const meshMap = renderSystem.getMeshMap();
    flickInputSystem.setMeshMap(meshMap);
    rapierVFXSystem.setMeshMap(meshMap);
  }

  /**
   * Populate the ECS world with the board, checker, and game-state entities.
   */
  private createEntities(): void {
    const em = this.world.entityManager;

    // Board
    em.addEntity(createBoardEntity());

    // Checkers
    for (const placement of INITIAL_POSITIONS) {
      const team = placement.team === 'white' ? TeamTag.White : TeamTag.Black;
      em.addEntity(createCheckerEntity(team, placement.position));
    }

    // Game-state singleton entity
    const gsEntity = new Entity();
    gsEntity.addComponent(new GameStateComponent(TeamTag.White));
    em.addEntity(gsEntity);
  }

  /**
   * Start the game loop.
   */
  public start(): void {
    const { composer, controls } = this.sceneCtx;

    this.world.start({
      afterFrame: () => {
        controls.update();          // damping needs per-frame update
        composer.render();
      },
    });
  }

  /**
   * Cleanup everything.
   */
  public dispose(): void {
    this.world.stop();
    this.world.dispose();
    this.sceneCtx.renderer.dispose();
  }
}
