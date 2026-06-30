import * as THREE from 'three';
import type { MatchFoundEvent, PhalanxClient } from '@phalanx-engine/client';
import type { CommandsBatch } from '@phalanx-engine/ecs';
import { ArenaScene } from './ArenaScene';
import { CameraController } from './CameraController';
import { GameUI } from './GameUI';
import { SimulationContainer } from './SimulationContainer';
import { FormationGridSystem } from '../systems/formation/FormationGridSystem';
import { MeshComponent } from '../components';
import type { TeamId } from '../components';

interface FormationPlayer {
  playerId: string;
  team: TeamId;
}

export class Game {
  private readonly client: PhalanxClient;
  private readonly localPlayerId: string;
  private readonly localTeamId: 0 | 1;
  private readonly players: FormationPlayer[];
  private readonly renderer: THREE.WebGLRenderer;
  private readonly arenaScene: ArenaScene;
  private readonly cameraController: CameraController;
  private readonly simulation: SimulationContainer;
  private formationGridSystem: FormationGridSystem;
  private readonly ui: GameUI;
  private readonly networkEventUnsubscribers: (() => void)[] = [];
  private gameOverShown = false;
  private deploymentHidden = false;
  private onExit: (() => void) | null = null;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement,
    client: PhalanxClient,
    matchData: MatchFoundEvent
  ) {
    this.client = client;
    this.localPlayerId = matchData.playerId;
    this.localTeamId = matchData.teamId === 1 ? 1 : 0;
    this.players = this.buildPlayerList(matchData);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.arenaScene = new ArenaScene();
    this.arenaScene.build();

    MeshComponent.initScene(this.arenaScene.scene);

    this.cameraController = new CameraController(this.localTeamId);
    this.cameraController.addListeners(canvas);

    this.simulation = new SimulationContainer(client, this.arenaScene.scene);

    this.formationGridSystem = new FormationGridSystem(
      this.arenaScene.scene,
      this.cameraController.camera,
      this.simulation.unitFactory,
      canvas,
      {
        onPlaceUnit: (playerId, unitType, gridX, gridZ) => {
          if (playerId !== this.localPlayerId) return;
          this.formationGridSystem.placeUnit(playerId, gridX, gridZ, unitType);
          this.client.sendCommand('formation-place', {
            playerId,
            type: unitType,
            gridX,
            gridZ,
          });
        },
        onMoveUnit: (playerId, fromX, fromZ, toX, toZ) => {
          if (playerId !== this.localPlayerId) return;
          this.formationGridSystem.moveUnit(playerId, fromX, fromZ, toX, toZ);
          this.client.sendCommand('formation-move', {
            playerId,
            fromX,
            fromZ,
            toX,
            toZ,
          });
        },
      }
    );

    this.registerPlayers();

    this.ui = new GameUI({
      onUnitDragStart: (type) => {
        this.formationGridSystem.startTouchDrag(this.localPlayerId, type);
      },
      onReady: () => {
        this.client.sendCommand('formation-ready', {
          playerId: this.localPlayerId,
        });
        this.ui.showWaitingStatus();
      },
      onReturnLobby: () => {
        this.dispose();
        this.client.disconnect();
        this.onExit?.();
      },
    });
    this.ui.addListeners();

    window.addEventListener('resize', this.onResize);
    this.networkEventUnsubscribers.push(
      this.client.on('matchEnd', () => this.ui.showResultOverlay('Match ended'))
    );
  }

  setOnExit(callback: () => void): void {
    this.onExit = callback;
  }

  async initialize(): Promise<void> {
    this.deploymentHidden = false;
    this.onResize();
    this.ui.showStartOverlay();
    this.ui.hideResultOverlay();
    this.simulation.world.start({
      beforeTick: (_tick: number, commandsBatch: CommandsBatch) => {
        this.simulation.formationSystem.processCommands(commandsBatch);
      },
      afterTick: () => {
        this.checkGameOver();
      },
      beforeFrame: (_alpha: number, dt: number) => {
        this.cameraController.update(dt);
      },
      afterFrame: () => {
        this.renderer.render(
          this.arenaScene.scene,
          this.cameraController.camera
        );
        if (!this.deploymentHidden && this.simulation.isSimulationActive()) {
          this.ui.hideStartOverlay();
          this.ui.hidePalette();
          this.deploymentHidden = true;
        }
      },
    });
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
    this.formationGridSystem.dispose();
    this.simulation.dispose();
    this.arenaScene.dispose();
    this.renderer.dispose();
  }

  private buildPlayerList(matchData: MatchFoundEvent): FormationPlayer[] {
    const localTeam = this.localTeamId;
    const opponentTeam: TeamId = localTeam === 0 ? 1 : 0;
    const players: FormationPlayer[] = [
      { playerId: this.localPlayerId, team: localTeam },
    ];

    for (const teammate of matchData.teammates) {
      if (teammate.playerId !== this.localPlayerId) {
        players.push({ playerId: teammate.playerId, team: localTeam });
      }
    }

    for (const opponent of matchData.opponents) {
      players.push({ playerId: opponent.playerId, team: opponentTeam });
    }

    return players;
  }

  private registerPlayers(): void {
    for (const { playerId, team } of this.players) {
      this.simulation.formationSystem.registerPlayer(playerId, team);
      this.formationGridSystem.initializeGrid(playerId, team);
    }
  }

  private checkGameOver(): void {
    if (this.gameOverShown || this.disposed) return;

    const title = this.simulation.getGameOverTitle(this.localTeamId);
    if (title === null) return;

    this.resetToDeployment();
  }

  private resetToDeployment(): void {
    this.simulation.resetBattle();

    this.gameOverShown = false;
    this.deploymentHidden = false;
    this.ui.hideResultOverlay();
    this.ui.showStartOverlay();
  }

  private readonly onResize = (): void => {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    this.cameraController.onResize(width, height);
    this.renderer.setSize(width, height, false);
  };
}
