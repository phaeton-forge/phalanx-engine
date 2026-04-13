import { GameWorld } from 'phalanx-ecs';
import { setupScene } from '../rendering/SceneSetup.ts';
import type { SceneContext } from '../rendering/SceneSetup.ts';
import { ThreeRenderSystem } from '../systems/ThreeRenderSystem.ts';
import { ComponentType } from '../components/Component.ts';
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
  private renderSystem: ThreeRenderSystem;

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
    this.renderSystem = new ThreeRenderSystem(this.sceneCtx.scene);

    // No tick systems for this stage — only a frame system
    this.world.registerSystems([], [this.renderSystem]);
  }

  /**
   * Populate the ECS world with the board and checker entities.
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

