import { Vector3, AbstractMesh } from '@babylonjs/core';
import type { TeamTag } from '../enums/TeamTag';

/**
 * Unit type for formation and unit events
 */
export type FormationUnitType = 'sphere' | 'mutant' | 'prisma' | 'lance';

/**
 * Base interface for all game events
 */
export interface GameEvent {
  readonly timestamp: number;
}

/**
 * Creates a base event with timestamp
 */
export function createEvent(): GameEvent {
  return { timestamp: performance.now() };
}

// ============================================
// Combat Events
// ============================================

export interface AttackRequestedEvent extends GameEvent {
  attackerId: number;
  targetId: number;
  damage: number;
  projectileSpeed: number;
  attackOrigin: Vector3;
  team: TeamTag;
}

export interface ProjectileSpawnedEvent extends GameEvent {
  origin: Vector3;
  direction: Vector3;
  damage: number;
  speed: number;
  team: TeamTag;
  sourceId: number; // ID of the entity that fired the projectile
}

export interface ProjectileHitEvent extends GameEvent {
  targetId: number;
  damage: number;
  position: Vector3;
  team: TeamTag;
  sourceId: number; // ID of the entity that fired the projectile
}

// ============================================
// Health Events
// ============================================

export interface DamageRequestedEvent extends GameEvent {
  entityId: number;
  amount: number;
  sourceId?: number;
}

export interface DamageAppliedEvent extends GameEvent {
  entityId: number;
  amount: number;
  newHealth: number;
  maxHealth: number;
  sourceId?: number; // ID of the entity that caused the damage
}

export interface HealRequestedEvent extends GameEvent {
  entityId: number;
  amount: number;
}

export interface EntityDyingEvent extends GameEvent {
  entityId: number;
}

export interface EntityDestroyedEvent extends GameEvent {
  entityId: number;
  position: Vector3;
}

// ============================================
// Movement Events
// ============================================

export interface MoveRequestedEvent extends GameEvent {
  entityId: number;
  target: Vector3;
  _fromNetwork?: boolean;
}

export interface MoveStartedEvent extends GameEvent {
  entityId: number;
  target: Vector3;
}

export interface MoveCompletedEvent extends GameEvent {
  entityId: number;
  position: Vector3;
}

export interface StopRequestedEvent extends GameEvent {
  entityId: number;
}


// ============================================
// Input Events
// ============================================

export interface LeftClickEvent extends GameEvent {
  pickedMesh: AbstractMesh | null;
  pickedPoint: Vector3 | null;
}

export interface RightClickEvent extends GameEvent {
  pickedMesh: AbstractMesh | null;
  pickedPoint: Vector3 | null;
}

export interface GroundClickedEvent extends GameEvent {
  position: Vector3;
  button: 'left' | 'right';
}

// ============================================
// Entity Lifecycle Events
// ============================================

export interface EntityCreatedEvent extends GameEvent {
  entityId: number;
  entityType: string;
  position: Vector3;
}

export interface EntityDisposedEvent extends GameEvent {
  entityId: number;
}

// ============================================
// UI Events
// ============================================

export interface ShowDestinationMarkerEvent extends GameEvent {
  position: Vector3;
}

export type HideDestinationMarkerEvent = GameEvent;

/**
 * Event emitted when resource UI should be updated
 * Contains all data needed to render the resource display
 */
export interface UIResourcesUpdatedEvent extends GameEvent {
  playerId: string;
  currentResources: number;
  currentGenerationRate: number;
  hasAggressionBonus: boolean;
  canAffordMutant: boolean;
  canAffordPrisma: boolean;
  canAffordLance: boolean;
}

/**
 * Event emitted when formation UI should be updated
 * Contains all data needed to render the formation info
 */
export interface UIFormationUpdatedEvent extends GameEvent {
  playerId: string;
  placedUnitCount: number;
}

// ============================================
// Resource Events
// ============================================

export interface ResourcesChangedEvent extends GameEvent {
  playerId: string;
  team: TeamTag;
  oldAmount: number;
  newAmount: number;
}

export interface ResourcesGeneratedEvent extends GameEvent {
  playerId: string;
  team: TeamTag;
  amount: number;
  currentTotal: number;
  generationRate: number;
}

export interface UnitPurchaseRequestedEvent extends GameEvent {
  playerId: string;
  team: TeamTag;
  unitType: FormationUnitType;
  gridPosition: { x: number; z: number };
}

export interface UnitPurchaseCompletedEvent extends GameEvent {
  playerId: string;
  team: TeamTag;
  unitType: FormationUnitType;
  entityId: number;
  cost: number;
}

export interface UnitPurchaseFailedEvent extends GameEvent {
  playerId: string;
  team: TeamTag;
  unitType: FormationUnitType;
  reason: 'insufficient_resources' | 'invalid_position' | 'grid_occupied';
}

// ============================================
// Territory Events
// ============================================

export interface TerritoryChangedEvent extends GameEvent {
  team: TeamTag;
  averagePosition: number; // X position of team's units
  onEnemyTerritory: boolean;
}

export interface AggressionBonusActivatedEvent extends GameEvent {
  team: TeamTag;
  bonusMultiplier: number;
}

export interface AggressionBonusDeactivatedEvent extends GameEvent {
  team: TeamTag;
}

// ============================================
// Game State Events
// ============================================

export interface GameStartedEvent extends GameEvent {
  team1PlayerId: string;
  team2PlayerId: string;
}

export interface GameOverEvent extends GameEvent {
  winnerTeam: TeamTag;
  winnerPlayerId: string;
  reason: 'base_destroyed' | 'disconnect' | 'forfeit';
}

export interface BaseDestroyedEvent extends GameEvent {
  team: TeamTag;
  entityId: number;
}

export interface TowerDestroyedEvent extends GameEvent {
  team: TeamTag;
  entityId: number;
  resourceBonus: number;
}

// ============================================
// Formation Events
// ============================================

export interface FormationPlacementRequestedEvent extends GameEvent {
  playerId: string;
  team: TeamTag;
  unitType: FormationUnitType;
  gridX: number;
  gridZ: number;
}

export interface FormationModeEnteredEvent extends GameEvent {
  playerId: string;
  unitType: FormationUnitType;
}

export interface FormationModeExitedEvent extends GameEvent {
  playerId: string;
}

export interface FormationUnitPlacedEvent extends GameEvent {
  playerId: string;
  unitType: FormationUnitType;
  gridX: number;
  gridZ: number;
}

export interface FormationPlacementFailedEvent extends GameEvent {
  playerId: string;
  unitType: FormationUnitType;
  reason: 'insufficient_resources' | 'invalid_position';
}

export interface FormationUnitRemovedEvent extends GameEvent {
  playerId: string;
  gridX: number;
  gridZ: number;
}

export interface FormationCommittedEvent extends GameEvent {
  playerId: string;
  unitCount: number;
}

export interface FormationUpdateModeEnteredEvent extends GameEvent {
  playerId: string;
  gridX: number;
  gridZ: number;
  unitType: FormationUnitType;
}

export interface FormationUpdateModeExitedEvent extends GameEvent {
  playerId: string;
}

export interface FormationUnitMoveRequestedEvent extends GameEvent {
  playerId: string;
  fromGridX: number;
  fromGridZ: number;
  toGridX: number;
  toGridZ: number;
}

export interface FormationUnitMovedEvent extends GameEvent {
  playerId: string;
  unitType: FormationUnitType;
  fromGridX: number;
  fromGridZ: number;
  toGridX: number;
  toGridZ: number;
}

// ============================================
// Wave Events
// ============================================

export interface WaveStartedEvent extends GameEvent {
  waveNumber: number;
  isPreparationWave: boolean;
}

export interface WaveCountdownEvent extends GameEvent {
  waveNumber: number;
  secondsRemaining: number;
  ticksRemaining: number;
}

export interface WaveDeploymentEvent extends GameEvent {
  waveNumber: number;
  totalUnitsDeployed: number;
}

// ============================================
// Animation Events (visual effects triggered by tick systems)
// ============================================

export interface PlayAttackAnimationEvent extends GameEvent {
  entityId: number;
}

export interface PlayDeathAnimationEvent extends GameEvent {
  entityId: number;
}

export interface ShowBloodEffectEvent extends GameEvent {
  entityId: number;
}

export interface OrientToTargetEvent extends GameEvent {
  entityId: number;
  targetPosition: Vector3;
}

export interface NotifyMovementStartedEvent extends GameEvent {
  entityId: number;
}

export interface EndCombatEvent extends GameEvent {
  entityId: number;
}

export interface OrientToMovementDirectionEvent extends GameEvent {
  entityId: number;
}

