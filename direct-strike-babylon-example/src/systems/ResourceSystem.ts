import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import { GameEvents, createEvent } from '../events';
import { TeamTag } from '../enums/TeamTag';
import { resourceConfig, unitConfig } from '../config/constants';
import type {
  ResourcesChangedEvent,
  ResourcesGeneratedEvent,
  UnitPurchaseRequestedEvent,
  UnitPurchaseCompletedEvent,
  UnitPurchaseFailedEvent,
  TowerDestroyedEvent,
  AggressionBonusActivatedEvent,
  AggressionBonusDeactivatedEvent,
  UIResourcesUpdatedEvent,
} from '../events';

/**
 * Player resource state
 */
interface PlayerResources {
  playerId: string;
  team: TeamTag;
  currentResources: number;
  baseGenerationRate: number; // Resources per second
  currentGenerationRate: number; // Resources per second (with modifiers)
  hasAggressionBonus: boolean;
}

/**
 * ResourceSystem - Manages passive resource generation and spending
 * Handles unit purchasing and territory-based bonuses
 * Extends GameSystem for consistent lifecycle management
 *
 * IMPORTANT: Resource generation is deterministic based on network ticks,
 * not frame delta time. This ensures both clients have identical resource counts.
 */
export class ResourceSystem extends GameSystem {
  private playerResources: Map<string, PlayerResources> = new Map();
  private lastProcessedTick: number = 0;
  private tickRate: number = 20; // Default: 20 ticks per second
  private lastUIUpdateTime: number = 0;

  constructor() {
    super();
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
    this.setupEventListeners();
  }

  /**
   * Set the tick rate for deterministic resource generation
   * @param tickRate - Number of ticks per second (default: 20)
   */
  public setTickRate(tickRate: number): void {
    this.tickRate = tickRate;
  }

  /**
   * Initialize resources for a player
   */
  public initializePlayer(playerId: string, team: TeamTag): void {
    this.playerResources.set(playerId, {
      playerId,
      team,
      currentResources: resourceConfig.initialResources,
      baseGenerationRate: resourceConfig.baseGenerationRate,
      currentGenerationRate: resourceConfig.baseGenerationRate,
      hasAggressionBonus: false,
    });

    // Emit initial UI update
    this.emitUIResourcesUpdate(playerId);
  }

  /**
   * Emit UI resources update event with all data needed for UI rendering
   */
  private emitUIResourcesUpdate(playerId: string): void {
    const resources = this.playerResources.get(playerId);
    if (!resources) return;

    this.eventBus.emit<UIResourcesUpdatedEvent>(
      GameEvents.UI_RESOURCES_UPDATED,
      {
        ...createEvent(),
        playerId,
        currentResources: resources.currentResources,
        currentGenerationRate: resources.currentGenerationRate,
        hasAggressionBonus: resources.hasAggressionBonus,
        canAffordMutant: resources.currentResources >= unitConfig.mutant.cost,
        canAffordPrisma: resources.currentResources >= unitConfig.prisma.cost,
        canAffordLance: resources.currentResources >= unitConfig.lance.cost,
      }
    );
  }

  private setupEventListeners(): void {
    // Listen for tower destruction to grant bonus
    this.subscribe<TowerDestroyedEvent>(
      GameEvents.TOWER_DESTROYED,
      (event) => {
        this.handleTowerDestroyed(event);
      }
    );

    // Listen for unit purchase requests
    this.subscribe<UnitPurchaseRequestedEvent>(
      GameEvents.UNIT_PURCHASE_REQUESTED,
      (event) => {
        this.handleUnitPurchaseRequest(event);
      }
    );

    // Listen for aggression bonus events
    this.subscribe<AggressionBonusActivatedEvent>(
      GameEvents.AGGRESSION_BONUS_ACTIVATED,
      (event) => {
        this.setAggressionBonus(event.team, true, event.bonusMultiplier);
      }
    );

    this.subscribe<AggressionBonusDeactivatedEvent>(
      GameEvents.AGGRESSION_BONUS_DEACTIVATED,
      (event) => {
        this.setAggressionBonus(event.team, false);
      }
    );
  }

  /**
   * Process a network tick for deterministic resource generation
   * Call this method for each network tick received from server
   * @param tick - The current network tick number
   */
  public override processTick(tick: number): void {
    // Skip if we've already processed this tick
    if (tick <= this.lastProcessedTick) {
      return;
    }

    // Calculate how many ticks to process (in case we missed some)
    const ticksToProcess = tick - this.lastProcessedTick;
    this.lastProcessedTick = tick;

    // Calculate resources per tick: rate per second / ticks per second
    const resourcesPerTick = 1 / this.tickRate;

    for (const [_playerId, resources] of this.playerResources) {
      const generated =
        resources.currentGenerationRate * resourcesPerTick * ticksToProcess;
      resources.currentResources += generated;
    }
  }

  /**
   * Update UI - call this each frame for smooth UI updates
   * This does NOT generate resources, only updates the display
   */
  public override update(_deltaTime: number): void {
    // Emit generation event periodically (not every frame to reduce noise)
    const currentTime = performance.now();
    if (currentTime - this.lastUIUpdateTime > 1000) {
      // Every second
      this.lastUIUpdateTime = currentTime;

      for (const [playerId, resources] of this.playerResources) {
        this.eventBus.emit<ResourcesGeneratedEvent>(
          GameEvents.RESOURCES_GENERATED,
          {
            ...createEvent(),
            playerId,
            team: resources.team,
            amount: resources.currentGenerationRate, // Rate per second
            currentTotal: resources.currentResources,
            generationRate: resources.currentGenerationRate,
          }
        );

        // Emit UI update event
        this.emitUIResourcesUpdate(playerId);
      }
    }
  }

  /**
   * Handle tower destroyed - grant bonus to attacking team
   */
  private handleTowerDestroyed(event: TowerDestroyedEvent): void {
    // Find the opposing team and grant bonus
    const opposingTeam =
      event.team === TeamTag.Team1 ? TeamTag.Team2 : TeamTag.Team1;

    for (const [playerId, resources] of this.playerResources) {
      if (resources.team === opposingTeam) {
        const oldAmount = resources.currentResources;
        resources.currentResources += event.resourceBonus;

        this.eventBus.emit<ResourcesChangedEvent>(
          GameEvents.RESOURCES_CHANGED,
          {
            ...createEvent(),
            playerId,
            team: resources.team,
            oldAmount,
            newAmount: resources.currentResources,
          }
        );

        // Emit UI update event
        this.emitUIResourcesUpdate(playerId);
      }
    }
  }

  /**
   * Handle unit purchase request
   */
  private handleUnitPurchaseRequest(event: UnitPurchaseRequestedEvent): void {
    const resources = this.getResourcesByTeam(event.team);
    if (!resources) {
      console.warn(
        `[ResourceSystem] No resources found for team ${event.team}`
      );
      return;
    }

    let cost: number;
    switch (event.unitType) {
      case 'sphere':
      case 'mutant':
        cost = unitConfig.mutant.cost;
        break;
      case 'prisma':
        cost = unitConfig.prisma.cost;
        break;
      case 'lance':
        cost = unitConfig.lance.cost;
        break;
    }

    if (resources.currentResources < cost) {
      this.eventBus.emit<UnitPurchaseFailedEvent>(
        GameEvents.UNIT_PURCHASE_FAILED,
        {
          ...createEvent(),
          playerId: event.playerId,
          team: event.team,
          unitType: event.unitType,
          reason: 'insufficient_resources',
        }
      );
      return;
    }

    // Deduct resources
    const oldAmount = resources.currentResources;
    resources.currentResources -= cost;

    this.eventBus.emit<ResourcesChangedEvent>(GameEvents.RESOURCES_CHANGED, {
      ...createEvent(),
      playerId: resources.playerId,
      team: resources.team,
      oldAmount,
      newAmount: resources.currentResources,
    });

    // The actual unit creation is handled by FormationGridSystem
    // We just emit the completion event here
    this.eventBus.emit<UnitPurchaseCompletedEvent>(
      GameEvents.UNIT_PURCHASE_COMPLETED,
      {
        ...createEvent(),
        playerId: event.playerId,
        team: event.team,
        unitType: event.unitType,
        entityId: 0, // Will be set by formation system
        cost,
      }
    );

    // Emit UI update event
    this.emitUIResourcesUpdate(resources.playerId);
  }

  /**
   * Set aggression bonus for a team
   */
  private setAggressionBonus(
    team: TeamTag,
    active: boolean,
    multiplier?: number
  ): void {
    for (const [playerId, resources] of this.playerResources) {
      if (resources.team === team) {
        resources.hasAggressionBonus = active;
        if (active && multiplier) {
          resources.currentGenerationRate =
            resources.baseGenerationRate * multiplier;
        } else {
          resources.currentGenerationRate = resources.baseGenerationRate;
        }

        // Emit UI update event
        this.emitUIResourcesUpdate(playerId);
      }
    }
  }

  /**
   * Get resources for a specific player
   */
  public getResources(playerId: string): number {
    return this.playerResources.get(playerId)?.currentResources ?? 0;
  }

  /**
   * Get resources by team
   */
  private getResourcesByTeam(team: TeamTag): PlayerResources | undefined {
    for (const resources of this.playerResources.values()) {
      if (resources.team === team) {
        return resources;
      }
    }
    return undefined;
  }

  /**
   * Get player resources object
   */
  public getPlayerResources(playerId: string): PlayerResources | undefined {
    return this.playerResources.get(playerId);
  }

  /**
   * Check if player can afford a unit
   */
  public canAfford(
    playerId: string,
    unitType: 'sphere' | 'mutant' | 'prisma' | 'lance'
  ): boolean {
    const resources = this.playerResources.get(playerId);
    if (!resources) return false;

    let cost: number;
    switch (unitType) {
      case 'sphere':
      case 'mutant':
        cost = unitConfig.mutant.cost;
        break;
      case 'prisma':
        cost = unitConfig.prisma.cost;
        break;
      case 'lance':
        cost = unitConfig.lance.cost;
        break;
    }
    return resources.currentResources >= cost;
  }

  /**
   * Cleanup
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.playerResources.clear();
  }
}
