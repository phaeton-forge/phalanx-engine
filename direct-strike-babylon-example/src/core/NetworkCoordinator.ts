import type { PhalanxClient } from 'phalanx-client';
import type { LockstepManager } from './LockstepManager';
import type { SystemRegistry, ITickFrameProvider, CommandsBatch } from 'phalanx-babylon-ecs';
import type { UIManager } from './UIManager';
import type { InterpolationSystem } from '../systems/InterpolationSystem';
import type { CameraController } from '../systems/CameraController';
import type { Scene } from '@babylonjs/core';

/**
 * Frame update context passed to NetworkCoordinator
 * These systems need special handling outside of SystemRegistry.updateAll()
 */
export interface FrameUpdateSystems {
  cameraController: CameraController;
  interpolationSystem: InterpolationSystem;
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
 * NetworkCoordinator - Handles network events and tick/frame loop wiring
 *
 * Responsible for:
 * - Player disconnect/reconnect events (via PhalanxClient)
 * - Match end events (via PhalanxClient)
 * - Tick processing via ITickFrameProvider (works with both PhalanxClient and TickFrameManager)
 * - Frame processing via ITickFrameProvider
 */
export class NetworkCoordinator {
  private client: PhalanxClient;
  private tickFrameProvider: ITickFrameProvider;
  private lockstepManager: LockstepManager;
  private systemRegistry: SystemRegistry;
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
    tickFrameProvider: ITickFrameProvider,
    lockstepManager: LockstepManager,
    systemRegistry: SystemRegistry,
    uiManager: UIManager,
    scene: Scene,
    frameSystems: FrameUpdateSystems,
    callbacks: NetworkCoordinatorCallbacks
  ) {
    this.client = client;
    this.tickFrameProvider = tickFrameProvider;
    this.lockstepManager = lockstepManager;
    this.systemRegistry = systemRegistry;
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
   * Setup tick and frame handlers via ITickFrameProvider
   * Works with both PhalanxClient (multiplayer) and TickFrameManager (single-player)
   */
  public setupPhalanxClientHandlers(): void {
    const { interpolationSystem } = this.frameSystems;

    // Register tick handler for simulation
    this.unsubscribeTick = this.tickFrameProvider.onTick(
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
    this.unsubscribeFrame = this.tickFrameProvider.onFrame((alpha: number, dt: number) => {
      this.processFrame(alpha, dt);
    });
  }

  /**
   * Process a single frame (rendering)
   */
  private processFrame(alpha: number, dt: number): void {
    const {
      cameraController,
      interpolationSystem,
    } = this.frameSystems;

    // Update camera controller (keyboard/touch input)
    cameraController.update(dt);

    // Update all frame-based systems through SystemRegistry
    // This handles: resourceSystem, animationSystem, rotationSystem,
    // combatSystem (turret rotation), healthBarSystem
    this.systemRegistry.updateAll(dt);

    // Interpolate visual positions using alpha from PhalanxClient
    interpolationSystem.interpolate(alpha);


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

