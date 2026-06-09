import * as THREE from 'three';
import type { MatchFoundEvent, PhalanxClient } from 'phalanx-client';
import type { CommandsBatch } from 'phalanx-ecs';
import { ArenaScene } from './ArenaScene';
import { CameraController } from './CameraController';
import { GameUI } from './GameUI';
import { SimulationContainer } from './SimulationContainer';
import { UnitFactory } from './UnitFactory';
import {MeshComponent} from "../components";

export class Game {
  private readonly client: PhalanxClient;
  private readonly matchData: MatchFoundEvent;
  private readonly localTeamId: 0 | 1;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly arenaScene: ArenaScene;
  private readonly cameraController: CameraController;
  private readonly simulation: SimulationContainer;
  private readonly ui: GameUI;
  private readonly networkEventUnsubscribers: (() => void)[] = [];
  private gameOverShown = false;
  private onExit: (() => void) | null = null;
  private disposed = false;
  private lastFrameDtSeconds = 0;

  constructor(canvas: HTMLCanvasElement, client: PhalanxClient, matchData: MatchFoundEvent) {
    this.client = client;
    this.matchData = matchData;
    this.localTeamId = matchData.teamId === 1 ? 1 : 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.arenaScene = new ArenaScene();
    this.arenaScene.build();

    MeshComponent.initScene(this.arenaScene.scene);

    this.cameraController = new CameraController(this.localTeamId);
    this.cameraController.addListeners(canvas);

    const unitFactory = new UnitFactory(this.arenaScene);
    this.simulation = new SimulationContainer(client, unitFactory, this.arenaScene.scene);

    this.ui = new GameUI(
      () => this.client.sendCommand('start-simulation', {}),
      () => { this.dispose(); this.client.disconnect(); this.onExit?.(); },
    );
    this.ui.addListeners();

    window.addEventListener('resize', this.onResize);
    this.networkEventUnsubscribers.push(
      this.client.on('matchEnd', () => this.ui.showResultOverlay('Match ended')),
    );
  }

  setOnExit(callback: () => void): void {
    this.onExit = callback;
  }

  async initialize(): Promise<void> {
    this.onResize();
    this.ui.showStartOverlay();
    this.ui.hideResultOverlay();
    this.simulation.linkTransformStore();
    this.simulation.world.start({
      beforeTick: (_tick: number, commandsBatch: CommandsBatch) => {
        this.simulation.startSimulationSystem.processCommands(commandsBatch);
      },
      afterTick: () => {
        this.checkGameOver();
      },
      beforeFrame: (_alpha: number, dt: number) => {
        this.lastFrameDtSeconds = dt;
        this.cameraController.update(dt);
      },
      afterFrame: () => {
        const dt = this.lastFrameDtSeconds || 0;

        this.simulation.updatePresentation(dt);
        this.simulation.renderSyncSystem.update(dt);
        this.renderer.render(this.arenaScene.scene, this.cameraController.camera);
      },
    });
    this.simulation.interpolationSystem.snapToCurrentPositions();
    this.client.sendReady();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.simulation.world.stop();
    for (const unsubscribe of this.networkEventUnsubscribers) unsubscribe();
    this.networkEventUnsubscribers.length = 0;
    this.ui.hideStartOverlay();
    this.ui.hideResultOverlay();
    this.ui.removeListeners();
    this.cameraController.removeListeners(this.renderer.domElement);
    window.removeEventListener('resize', this.onResize);
    this.simulation.dispose();
    this.arenaScene.dispose();
    this.renderer.dispose();
  }

  private checkGameOver(): void {
    if (this.gameOverShown || this.disposed) return;

    const title = this.simulation.getGameOverTitle(this.localTeamId);

    if (title === null) return;

    this.gameOverShown = true;
    this.ui.showResultOverlay(title);
  }

  private readonly onResize = (): void => {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    this.cameraController.onResize(width, height);
    this.renderer.setSize(width, height, false);
  };
}