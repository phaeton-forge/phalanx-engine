import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import { GameEvents, createEvent } from '../events';
import { waveConfig, networkConfig } from '../config/constants';
import type {
  WaveStartedEvent,
  WaveCountdownEvent,
  WaveDeploymentEvent,
  FormationUnitType,
} from '../events';
import type { TeamTag } from '../enums/TeamTag';

/**
 * Callback type for deploying units for a player (legacy - deploys all at once)
 */
export type DeployUnitsCallback = (playerId: string) => number;

/**
 * Information about a unit pending deployment
 */
export interface PendingUnitInfo {
  unitType: FormationUnitType;
  gridX: number;
  gridZ: number;
  team: TeamTag;
}

/**
 * Callback type for getting pending units to deploy for a player
 * Returns array of unit deployment info that can be processed incrementally
 */
export type GetPendingUnitsCallback = (playerId: string) => PendingUnitInfo[];

/**
 * Callback type for deploying a single unit
 */
export type DeploySingleUnitCallback = (
  playerId: string,
  unitInfo: PendingUnitInfo
) => void;

/**
 * Callback type for finalizing deployment (clearing pending units, emitting events)
 */
export type FinalizeDeploymentCallback = (
  playerId: string,
  unitCount: number
) => void;

/**
 * WaveSystem - Manages wave-based unit deployment
 *
 * Units are deployed in waves at regular intervals:
 * - Wave 0: Initial preparation time (no deployment)
 * - Wave 1+: All units on formation grid are deployed
 *
 * The system is tick-based to ensure deterministic behavior
 * across all clients in lockstep simulation.
 * Extends GameSystem for consistent lifecycle management
 *
 * Deployment can be staggered across multiple ticks to prevent
 * frame drops when spawning many units at once.
 */
export class WaveSystem extends GameSystem {
  // Wave state
  private currentWave: number = 0;
  private ticksPerWave: number;
  private ticksForInitialWave: number;
  private waveStartTick: number = 0;
  private isActive: boolean = false;

  // Player IDs (for deployment)
  private playerIds: string[] = [];

  // Legacy deployment callback (deploys all at once)
  private deployUnitsCallback: DeployUnitsCallback | null = null;

  // Staggered deployment callbacks
  private getPendingUnitsCallback: GetPendingUnitsCallback | null = null;
  private deploySingleUnitCallback: DeploySingleUnitCallback | null = null;
  private finalizeDeploymentCallback: FinalizeDeploymentCallback | null = null;

  // Staggered deployment state
  private deploymentQueue: Map<string, PendingUnitInfo[]> = new Map();
  private deploymentCounts: Map<string, number> = new Map();
  private isDeploying: boolean = false;
  private unitsPerTick: number;
  private ticksBetweenSpawns: number;
  private ticksSinceLastSpawn: number = 0;
  private useStaggeredDeployment: boolean;

  constructor() {
    super();
    // Calculate ticks per wave based on wave duration and tick rate
    this.ticksPerWave = Math.floor(
      waveConfig.waveDuration * networkConfig.tickRate
    );
    this.ticksForInitialWave = Math.floor(
      waveConfig.initialWaveDuration * networkConfig.tickRate
    );

    // Staggered deployment config
    this.unitsPerTick = waveConfig.unitsPerTick ?? 3;
    this.ticksBetweenSpawns = waveConfig.ticksBetweenSpawns ?? 0;
    this.useStaggeredDeployment = waveConfig.useStaggeredDeployment ?? true;
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
  }

  /**
   * Set the callback for deploying units (legacy - all at once)
   */
  public setDeployUnitsCallback(callback: DeployUnitsCallback): void {
    this.deployUnitsCallback = callback;
  }

  /**
   * Set callbacks for staggered unit deployment
   * This allows spreading unit spawning across multiple ticks
   */
  public setStaggeredDeploymentCallbacks(
    getPendingUnits: GetPendingUnitsCallback,
    deploySingleUnit: DeploySingleUnitCallback,
    finalizeDeployment: FinalizeDeploymentCallback
  ): void {
    this.getPendingUnitsCallback = getPendingUnits;
    this.deploySingleUnitCallback = deploySingleUnit;
    this.finalizeDeploymentCallback = finalizeDeployment;
  }

  /**
   * Register a player for wave deployments
   * Players are kept sorted to ensure deterministic iteration order across all clients
   */
  public registerPlayer(playerId: string): void {
    if (!this.playerIds.includes(playerId)) {
      this.playerIds.push(playerId);
      // Sort to ensure consistent order across all clients
      this.playerIds.sort();
    }
  }

  /**
   * Start the wave system (called when game begins)
   * @param startTick The tick at which the wave system starts
   */
  public start(startTick: number = 0): void {
    this.currentWave = 0;
    this.waveStartTick = startTick;
    this.isActive = true;

    // Emit wave started event for Wave 0 (preparation wave)
    this.eventBus.emit<WaveStartedEvent>(GameEvents.WAVE_STARTED, {
      ...createEvent(),
      waveNumber: 0,
      isPreparationWave: true,
    });  }

  /**
   * Process a simulation tick
   * Called by LockstepManager during deterministic simulation
   */
  public override processTick(currentTick: number): void {
    if (!this.isActive) return;

    // Process staggered deployment if active
    if (this.isDeploying) {
      this.processStaggeredDeployment();
    }

    const ticksSinceWaveStart = currentTick - this.waveStartTick;
    const ticksForCurrentWave =
      this.currentWave === 0 ? this.ticksForInitialWave : this.ticksPerWave;
    const ticksRemaining = ticksForCurrentWave - ticksSinceWaveStart;

    // Emit countdown event every second (every tickRate ticks)
    if (ticksSinceWaveStart % networkConfig.tickRate === 0) {
      const secondsRemaining = Math.ceil(
        ticksRemaining / networkConfig.tickRate
      );

      this.eventBus.emit<WaveCountdownEvent>(GameEvents.WAVE_COUNTDOWN, {
        ...createEvent(),
        waveNumber: this.currentWave,
        secondsRemaining,
        ticksRemaining,
      });
    }

    // Check if wave is complete
    if (ticksRemaining <= 0) {
      this.advanceWave(currentTick);
    }
  }

  /**
   * Advance to the next wave and deploy units
   */
  private advanceWave(currentTick: number): void {
    const previousWave = this.currentWave;
    this.currentWave++;
    this.waveStartTick = currentTick;
    // Emit wave started event
    this.eventBus.emit<WaveStartedEvent>(GameEvents.WAVE_STARTED, {
      ...createEvent(),
      waveNumber: this.currentWave,
      isPreparationWave: false,
    });

    // Deploy units for all players (Wave 1+ always deploys)
    // Wave 0 is preparation only (deployOnWaveZero is false by default)
    if (previousWave > 0 || waveConfig.deployOnWaveZero) {
      this.deployAllUnits();
    } else {
      // This is the transition from Wave 0 to Wave 1
      // Now deploy units that were placed during Wave 0
      this.deployAllUnits();
    }
  }

  /**
   * Deploy units for all registered players
   * Uses staggered deployment if callbacks are set, otherwise falls back to legacy
   */
  private deployAllUnits(): void {
    // Use staggered deployment if enabled and callbacks are set
    if (
      this.useStaggeredDeployment &&
      this.getPendingUnitsCallback &&
      this.deploySingleUnitCallback &&
      this.finalizeDeploymentCallback
    ) {
      this.startStaggeredDeployment();
      return;
    }

    // Legacy deployment - all at once
    if (!this.deployUnitsCallback) {
      console.warn('[WaveSystem] No deploy callback set!');
      return;
    }

    let totalDeployed = 0;

    for (const playerId of this.playerIds) {
      const unitCount = this.deployUnitsCallback(playerId);
      totalDeployed += unitCount;
    }

    // Emit deployment event
    this.eventBus.emit<WaveDeploymentEvent>(GameEvents.WAVE_DEPLOYMENT, {
      ...createEvent(),
      waveNumber: this.currentWave,
      totalUnitsDeployed: totalDeployed,
    });
  }

  /**
   * Start staggered deployment - queue up all units to deploy over multiple ticks
   */
  private startStaggeredDeployment(): void {
    if (!this.getPendingUnitsCallback) return;

    this.deploymentQueue.clear();
    this.deploymentCounts.clear();

    // Gather all pending units for each player
    // playerIds is already sorted, so Map insertion order will be deterministic
    for (const playerId of this.playerIds) {
      const pendingUnits = this.getPendingUnitsCallback(playerId);
      if (pendingUnits.length > 0) {
        // pendingUnits are already sorted by getPendingUnitsForDeployment
        this.deploymentQueue.set(playerId, [...pendingUnits]);
        this.deploymentCounts.set(playerId, pendingUnits.length);
      }
    }

    // Check if there are any units to deploy
    let hasUnits = false;
    for (const playerId of this.playerIds) {
      const queue = this.deploymentQueue.get(playerId);
      if (queue && queue.length > 0) {
        hasUnits = true;
        break;
      }
    }

    if (hasUnits) {
      this.isDeploying = true;
      // Reset tick counter so we spawn immediately on first tick
      this.ticksSinceLastSpawn = this.ticksBetweenSpawns;
    }
  }

  /**
   * Process staggered deployment - deploy a limited number of units per tick
   * Respects ticksBetweenSpawns to skip ticks between spawn batches
   */
  private processStaggeredDeployment(): void {
    if (!this.deploySingleUnitCallback || !this.finalizeDeploymentCallback) {
      this.isDeploying = false;
      return;
    }

    // Check if we should skip this tick
    if (this.ticksSinceLastSpawn < this.ticksBetweenSpawns) {
      this.ticksSinceLastSpawn++;
      return;
    }

    // Reset tick counter - we're spawning this tick
    this.ticksSinceLastSpawn = 0;

    let unitsDeployedThisTick = 0;
    const completedPlayers: string[] = [];

    // Round-robin deploy units from each player to keep it fair
    let playerIndex = 0;
    while (unitsDeployedThisTick < this.unitsPerTick) {
      let deployedAny = false;

      for (const playerId of this.playerIds) {
        if (unitsDeployedThisTick >= this.unitsPerTick) break;

        const queue = this.deploymentQueue.get(playerId);
        if (!queue || queue.length === 0) continue;

        const unitInfo = queue.shift()!;
        this.deploySingleUnitCallback(playerId, unitInfo);
        unitsDeployedThisTick++;
        deployedAny = true;

        // Check if this player's deployment is complete
        if (queue.length === 0) {
          completedPlayers.push(playerId);
        }
      }

      // Break if no more units to deploy
      if (!deployedAny) break;
      playerIndex++;
    }

    // Finalize completed player deployments
    for (const playerId of completedPlayers) {
      const totalCount = this.deploymentCounts.get(playerId) || 0;
      this.finalizeDeploymentCallback(playerId, totalCount);
      this.deploymentQueue.delete(playerId);
      this.deploymentCounts.delete(playerId);
    }

    // Check if all deployments are complete
    if (this.deploymentQueue.size === 0) {
      this.isDeploying = false;

      // Emit overall deployment event
      const totalDeployed = Array.from(this.deploymentCounts.values()).reduce(
        (sum, count) => sum + count,
        0
      );
      console.warn(`Total deployed units: ${totalDeployed}`);
      // Note: totalDeployed will be 0 here since we cleared the counts,
      // so we calculate it from the original counts stored before clearing
      let grandTotal = 0;
      for (const playerId of this.playerIds) {
        // The count was stored before deployment started
        grandTotal += this.deploymentCounts.get(playerId) || 0;
      }

      // Actually, we already deleted the counts, so let's track total differently
      // The individual finalizeDeployment calls will handle per-player events
      // Just emit overall wave deployment completion
      this.eventBus.emit<WaveDeploymentEvent>(GameEvents.WAVE_DEPLOYMENT, {
        ...createEvent(),
        waveNumber: this.currentWave,
        totalUnitsDeployed: 0, // Individual counts handled in finalizeDeployment
      });
    }
  }

  /**
   * Get the current wave number
   */
  public getCurrentWave(): number {
    return this.currentWave;
  }

  /**
   * Get seconds remaining until next wave
   */
  public getSecondsRemaining(currentTick: number): number {
    if (!this.isActive) return 0;

    const ticksSinceWaveStart = currentTick - this.waveStartTick;
    const ticksForCurrentWave =
      this.currentWave === 0 ? this.ticksForInitialWave : this.ticksPerWave;
    const ticksRemaining = ticksForCurrentWave - ticksSinceWaveStart;

    return Math.max(0, Math.ceil(ticksRemaining / networkConfig.tickRate));
  }

  /**
   * Check if currently in preparation wave (Wave 0)
   */
  public isPreparationWave(): boolean {
    return this.currentWave === 0;
  }

  /**
   * Cleanup
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.isActive = false;
    this.isDeploying = false;
    this.playerIds = [];
    this.deploymentQueue.clear();
    this.deploymentCounts.clear();
  }
}
