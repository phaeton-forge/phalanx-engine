import type { SystemContext } from '@phalanx-engine/ecs';
import { GameSystem } from '@phalanx-engine/ecs';
import { GameEvents, createEvent } from '../events';
import { TeamTag } from '../enums/TeamTag';
import { ComponentType, TeamComponent, TransformComponent } from '../components';
import { arenaParams, resourceConfig } from '../config/constants';
import type {
  AggressionBonusActivatedEvent,
  AggressionBonusDeactivatedEvent,
} from '../events';

/**
 * Territory state for a team
 */
interface TeamTerritoryState {
  team: TeamTag;
  averageUnitPosition: number; // X position
  onEnemyTerritory: boolean;
  hasAggressionBonus: boolean;
}

/**
 * TerritorySystem - Tracks unit positions and determines territorial control
 * Manages aggression bonus for teams that push past the center line
 * Extends GameSystem for consistent lifecycle management
 */
export class TerritorySystem extends GameSystem {
  private territoryState: Map<TeamTag, TeamTerritoryState> = new Map();
  private centerLine: number;
  // Update every 10 ticks (500ms at 20 ticks/sec) for deterministic throttling
  private updateIntervalTicks: number = 10;
  private lastUpdateTick: number = 0;

  constructor() {
    super();
    this.centerLine = arenaParams.divider.x;

    // Initialize territory state for both teams
    this.territoryState.set(TeamTag.Team1, {
      team: TeamTag.Team1,
      averageUnitPosition: arenaParams.teamA.formationGridCenter.x,
      onEnemyTerritory: false,
      hasAggressionBonus: false,
    });

    this.territoryState.set(TeamTag.Team2, {
      team: TeamTag.Team2,
      averageUnitPosition: arenaParams.teamB.formationGridCenter.x,
      onEnemyTerritory: false,
      hasAggressionBonus: false,
    });
  }

  /**
   * Initialize the system with context
   */
  public override init(context: SystemContext): void {
    super.init(context);
  }

  /**
   * Process territory tick - deterministic territory tracking
   * Called once per simulation tick
   */
  public override processTick(tick: number): void {
    // Only update periodically to reduce computation (every 10 ticks = 500ms)
    if (tick - this.lastUpdateTick < this.updateIntervalTicks) {
      return;
    }
    this.lastUpdateTick = tick;

    // Calculate positions for both teams first
    this.calculateTeamPositions();

    // Then update aggression bonuses considering both teams
    this.updateAggressionBonuses();
  }

  /**
   * Calculate average positions for both teams
   */
  private calculateTeamPositions(): void {
    const entities = this.entityManager.getAllEntities();

    // Reset counters
    const teamData = new Map<TeamTag, { totalX: number; unitCount: number }>();
    teamData.set(TeamTag.Team1, { totalX: 0, unitCount: 0 });
    teamData.set(TeamTag.Team2, { totalX: 0, unitCount: 0 });

    // Calculate average X position of all units for each team
    for (const entity of entities) {
      const teamComponent = entity.getComponent<TeamComponent>(
        ComponentType.Team
      );
      if (!teamComponent) continue;

      // Only count mobile units (not bases or towers)
      if (!entity.hasComponent(ComponentType.Movement)) continue;

      const transform = entity.getComponent<TransformComponent>(ComponentType.Transform);
      if (!transform) continue;

      const data = teamData.get(teamComponent.team);
      if (data) {
        data.totalX += transform.visualPosition.x;
        data.unitCount++;
      }
    }

    // Update territory state for each team
    for (const [team, data] of teamData) {
      const state = this.territoryState.get(team)!;

      // If team has no mobile units, they can't be on enemy territory
      if (data.unitCount === 0) {
        state.onEnemyTerritory = false;
        continue;
      }

      const averageX = data.totalX / data.unitCount;
      state.averageUnitPosition = averageX;

      // Determine if team is on enemy territory
      if (team === TeamTag.Team1) {
        state.onEnemyTerritory = averageX > this.centerLine;
      } else {
        state.onEnemyTerritory = averageX < this.centerLine;
      }
    }
  }

  /**
   * Update aggression bonuses for both teams
   * A team has aggression bonus if:
   * 1. Their units are on enemy territory, AND
   * 2. Enemy units are NOT on their territory
   */
  private updateAggressionBonuses(): void {
    const team1State = this.territoryState.get(TeamTag.Team1)!;
    const team2State = this.territoryState.get(TeamTag.Team2)!;

    // Team1 has bonus if: Team1 is on Team2's side AND Team2 is NOT on Team1's side
    const team1ShouldHaveBonus =
      team1State.onEnemyTerritory && !team2State.onEnemyTerritory;

    // Team2 has bonus if: Team2 is on Team1's side AND Team1 is NOT on Team2's side
    const team2ShouldHaveBonus =
      team2State.onEnemyTerritory && !team1State.onEnemyTerritory;

    // Update Team1 bonus
    this.updateTeamAggressionBonus(TeamTag.Team1, team1ShouldHaveBonus);

    // Update Team2 bonus
    this.updateTeamAggressionBonus(TeamTag.Team2, team2ShouldHaveBonus);
  }

  /**
   * Update aggression bonus for a specific team
   */
  private updateTeamAggressionBonus(
    team: TeamTag,
    shouldHaveBonus: boolean
  ): void {
    const state = this.territoryState.get(team)!;

    if (shouldHaveBonus && !state.hasAggressionBonus) {
      state.hasAggressionBonus = true;
      this.eventBus.emit<AggressionBonusActivatedEvent>(
        GameEvents.AGGRESSION_BONUS_ACTIVATED,
        {
          ...createEvent(),
          team,
          bonusMultiplier: resourceConfig.aggressionBonusMultiplier,
        }
      );    } else if (!shouldHaveBonus && state.hasAggressionBonus) {
      state.hasAggressionBonus = false;
      this.eventBus.emit<AggressionBonusDeactivatedEvent>(
        GameEvents.AGGRESSION_BONUS_DEACTIVATED,
        {
          ...createEvent(),
          team,
        }
      );
    }
  }

  /**
   * Get territory state for a team
   */
  public getTerritoryState(team: TeamTag): TeamTerritoryState | undefined {
    return this.territoryState.get(team);
  }

  /**
   * Check if a team has aggression bonus
   */
  public hasAggressionBonus(team: TeamTag): boolean {
    return this.territoryState.get(team)?.hasAggressionBonus ?? false;
  }

  /**
   * Get the center line position
   */
  public getCenterLine(): number {
    return this.centerLine;
  }

  /**
   * Cleanup
   */
  public override dispose(): void {
    super.dispose(); // Clean up subscriptions from base class
    this.territoryState.clear();
  }
}
