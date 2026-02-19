/**
 * Event type constants for the game
 * Using constants ensures type safety and prevents typos
 */
export const GameEvents = {
  // Combat events
  ATTACK_REQUESTED: 'combat:attackRequested',
  PROJECTILE_SPAWNED: 'combat:projectileSpawned',
  PROJECTILE_HIT: 'combat:projectileHit',

  // Health events
  DAMAGE_REQUESTED: 'health:damageRequested',
  DAMAGE_APPLIED: 'health:damageApplied',
  HEAL_REQUESTED: 'health:healRequested',
  ENTITY_DYING: 'health:entityDying',
  ENTITY_DESTROYED: 'health:entityDestroyed',

  // Movement events
  MOVE_REQUESTED: 'movement:moveRequested',
  MOVE_STARTED: 'movement:moveStarted',
  MOVE_COMPLETED: 'movement:moveCompleted',
  STOP_REQUESTED: 'movement:stopRequested',


  // Input events
  LEFT_CLICK: 'input:leftClick',
  RIGHT_CLICK: 'input:rightClick',
  GROUND_CLICKED: 'input:groundClicked',

  // Entity lifecycle events
  ENTITY_CREATED: 'entity:created',
  ENTITY_DISPOSED: 'entity:disposed',

  // UI events
  SHOW_DESTINATION_MARKER: 'ui:showDestinationMarker',
  HIDE_DESTINATION_MARKER: 'ui:hideDestinationMarker',
  UI_RESOURCES_UPDATED: 'ui:resourcesUpdated',
  UI_FORMATION_UPDATED: 'ui:formationUpdated',

  // Resource events
  RESOURCES_CHANGED: 'resource:changed',
  RESOURCES_GENERATED: 'resource:generated',
  UNIT_PURCHASE_REQUESTED: 'resource:purchaseRequested',
  UNIT_PURCHASE_COMPLETED: 'resource:purchaseCompleted',
  UNIT_PURCHASE_FAILED: 'resource:purchaseFailed',

  // Territory events
  TERRITORY_CHANGED: 'territory:changed',
  AGGRESSION_BONUS_ACTIVATED: 'territory:aggressionBonus',
  AGGRESSION_BONUS_DEACTIVATED: 'territory:aggressionBonusLost',

  // Game state events
  GAME_STARTED: 'game:started',
  GAME_OVER: 'game:over',
  BASE_DESTROYED: 'game:baseDestroyed',
  TOWER_DESTROYED: 'game:towerDestroyed',

  // Formation events
  FORMATION_MODE_ENTERED: 'formation:entered',
  FORMATION_MODE_EXITED: 'formation:exited',
  FORMATION_PLACEMENT_REQUESTED: 'formation:placementRequested',
  FORMATION_PLACEMENT_FAILED: 'formation:placementFailed',
  FORMATION_UNIT_PLACED: 'formation:unitPlaced',
  FORMATION_UNIT_REMOVED: 'formation:unitRemoved',
  FORMATION_COMMITTED: 'formation:committed',
  FORMATION_UPDATE_MODE_ENTERED: 'formation:updateModeEntered',
  FORMATION_UPDATE_MODE_EXITED: 'formation:updateModeExited',
  FORMATION_UNIT_MOVE_REQUESTED: 'formation:unitMoveRequested',
  FORMATION_UNIT_MOVED: 'formation:unitMoved',

  // Wave events
  WAVE_STARTED: 'wave:started',
  WAVE_COUNTDOWN: 'wave:countdown',
  WAVE_DEPLOYMENT: 'wave:deployment',

  // Animation events (visual effects triggered by tick systems)
  PLAY_ATTACK_ANIMATION: 'animation:playAttack',
  PLAY_DEATH_ANIMATION: 'animation:playDeath',
  SHOW_BLOOD_EFFECT: 'animation:showBlood',
  ORIENT_TO_TARGET: 'animation:orientToTarget',
  NOTIFY_MOVEMENT_STARTED: 'animation:movementStarted',
  END_COMBAT: 'animation:endCombat',
  ORIENT_TO_MOVEMENT_DIRECTION: 'animation:orientToMovementDirection',
} as const;

export type GameEventType = (typeof GameEvents)[keyof typeof GameEvents];
