import type { PhalanxClient, CommandsBatch } from 'phalanx-client';
import type { LockstepManager } from './LockstepManager';
import type { UIManager } from './UIManager';
import type { InterpolationSystem } from '../systems/InterpolationSystem';
import type { ResourceSystem } from '../systems/ResourceSystem';
import type { CombatSystem } from '../systems/CombatSystem';
import type { AnimationSystem } from '../systems/AnimationSystem';
import type { RotationSystem } from '../systems/RotationSystem';
import type { HealthBarSystem } from '../systems/HealthBarSystem';
import type { CameraController } from '../systems/CameraController';
import type { Scene } from '@babylonjs/core';

/**
 * Frame update context passed to NetworkCoordinator
 */
export interface FrameUpdateSystems {
  cameraController: CameraController;
  resourceSystem: ResourceSystem;
  combatSystem: CombatSystem;
  animationSystem: AnimationSystem;
  rotationSystem: RotationSystem;
  interpolationSystem: InterpolationSystem;
  healthBarSystem: HealthBarSystem;
}

/**
 * Callbacks for NetworkCoordinator
 */
export interface NetworkCoordinatorCallbacks {
  onPlayerDisconnected: () => void;
  onPlayerReconnected: () => void;
  onMatchEnd: (reason: string) => void;
}

/**
 * NetworkCoordinator - Handles all PhalanxClient network events
 *
 * Responsible for:
 * - Player disconnect/reconnect events
 * - Match end events
 * - Tick processing (simulation)
 * - Frame processing (rendering)
 */
export class NetworkCoordinator {
  private client: PhalanxClient;
  private lockstepManager: LockstepManager;
  private uiManager: UIManager;
  private scene: Scene;
  private frameSystems: FrameUpdateSystems;
  private callbacks: NetworkCoordinatorCallbacks;

  // Unsubscribe functions
  private unsubscribeTick: (() => void) | null = null;
  private unsubscribeFrame: (() => void) | null = null;
  private networkEventUnsubscribers: (() => void)[] = [];

  constructor(
    client: PhalanxClient,
    lockstepManager: LockstepManager,
    uiManager: UIManager,
    scene: Scene,
    frameSystems: FrameUpdateSystems,
    callbacks: NetworkCoordinatorCallbacks
  ) {
    this.client = client;
    this.lockstepManager = lockstepManager;
    this.uiManager = uiManager;
    this.scene = scene;
    this.frameSystems = frameSystems;
    this.callbacks = callbacks;
  }

  /**
   * Setup all network event handlers
   */
  public setupNetworkEventHandlers(): void {
    this.networkEventUnsubscribers.push(
      this.client.on('playerDisconnected', (_event) => {
        this.uiManager.showNotification('Opponent disconnected', 'warning');
        setTimeout(() => {
          this.callbacks.onPlayerDisconnected();
        }, 3000);
      })
    );

    this.networkEventUnsubscribers.push(
      this.client.on('playerReconnected', (_event) => {
        this.uiManager.showNotification('Opponent reconnected', 'info');
        this.callbacks.onPlayerReconnected();
      })
    );

    this.networkEventUnsubscribers.push(
      this.client.on('matchEnd', (event) => {
        this.uiManager.showNotification(`Match ended: ${event.reason}`, 'info');
        setTimeout(() => {
          this.callbacks.onMatchEnd(event.reason);
        }, 2000);
      })
    );
  }

  /**
   * Setup PhalanxClient tick and frame handlers
   */
  public setupPhalanxClientHandlers(): void {
    const { interpolationSystem } = this.frameSystems;

    // Register tick handler for simulation
    this.unsubscribeTick = this.client.onTick(
      (tick: number, commandsBatch: CommandsBatch) => {
        // Snapshot positions before simulation
        interpolationSystem.snapshotPositions();

        // Process the tick through lockstep manager
        this.lockstepManager.processTick(tick, commandsBatch);

        // Capture new positions after simulation
        interpolationSystem.captureCurrentPositions();
      }
    );

    // Register frame handler for rendering
    this.unsubscribeFrame = this.client.onFrame((alpha: number, dt: number) => {
      this.processFrame(alpha, dt);
    });
  }

  /**
   * Process a single frame (rendering)
   */
  private processFrame(alpha: number, dt: number): void {
    const {
      cameraController,
      resourceSystem,
      combatSystem,
      animationSystem,
      rotationSystem,
      interpolationSystem,
      healthBarSystem,
    } = this.frameSystems;

    // Update camera controller (keyboard/touch input)
    cameraController.update(dt);

    // Update systems that need frame-rate updates
    resourceSystem.update(0);

    // Update tower turret rotations for smooth visual rotation
    combatSystem.updateTowerTurrets(dt);

    // Update MutantUnit animations and rotations based on movement state
    animationSystem.update();
    rotationSystem.update(dt);

    // Interpolate visual positions using alpha from PhalanxClient
    interpolationSystem.interpolate(alpha);

    // Update health bars (billboarding and position updates)
    healthBarSystem.update();

    // Render the scene
    this.scene.render();
  }

  /**
   * Dispose and cleanup
   */
  public dispose(): void {
    // Unsubscribe from PhalanxClient handlers first to stop rendering/simulation
    if (this.unsubscribeTick) {
      this.unsubscribeTick();
      this.unsubscribeTick = null;
    }
    if (this.unsubscribeFrame) {
      this.unsubscribeFrame();
      this.unsubscribeFrame = null;
    }

    // Unsubscribe from network event handlers
    for (const unsubscribe of this.networkEventUnsubscribers) {
      unsubscribe();
    }
    this.networkEventUnsubscribers = [];
  }
}

